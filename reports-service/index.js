const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");
require('dotenv').config();
const axios = require('axios');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const MongoStore = require('connect-mongo');

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: { folder: 'reportes-ciudadanos', format: 'jpg', public_id: (req, file) => `reporte-${Date.now()}` },
});

const upload = multer({ storage: storage });
const Report = require('./models/Report');
const User = require('./models/User');

const app = express();

const isProduction = process.env.NODE_ENV === 'production';
const frontendUrl = isProduction ? process.env.FRONTEND_URL : 'http://localhost:3000';
const backendUrl = isProduction ? process.env.BACKEND_URL : 'http://localhost:5000';
const allowedOrigins = frontendUrl.split(',');

const corsOptions = {
  origin: function (origin, callback) {
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "DELETE"]
};

app.use(cors(corsOptions));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'secretkey',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/google/callback`
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await User.findOne({ googleId: profile.id });
        if (!user) {
            user = await User.create({
                googleId: profile.id,
                displayName: profile.displayName,
                email: profile.emails[0].value,
                image: profile.photos[0].value
            });
        }
        done(null, user);
    } catch (err) {
        done(err, null);
    }
  }
));

passport.serializeUser((user, done) => { done(null, user.id); });
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigins, methods: ["GET", "POST", "DELETE"] } });

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Conexión a MongoDB exitosa"))
    .catch(err => console.error("Error de conexión a MongoDB:", err));

const getMunicipality = async (lat, lng) => {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&countrycodes=gt&accept-language=es`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'ActuaApp/1.0 (tu.email.real@ejemplo.com)' } });
        const address = response.data.address;
        return address.city || address.town || address.state_district || address.county || address.state || 'No identificado';
    } catch (error) {
        console.error("Error en Reverse Geocoding:", error.message);
        return 'No identificado';
    }
};

const ensureAuth = (req, res, next) => { if (req.isAuthenticated()) { return next(); } res.status(401).json({ message: 'No autenticado' }); };
const ensureAdmin = (req, res, next) => { if (req.isAuthenticated() && req.user.role === 'admin') { return next(); } res.status(403).json({ message: 'Acceso denegado' }); };

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect(frontendUrl));
app.get('/auth/logout', (req, res, next) => { req.logout(err => { if (err) { return next(err); } res.redirect(frontendUrl); }); });
app.get('/auth/me', (req, res) => { res.json(req.user || null); });

app.get('/reports', async (req, res) => {
    try {
        const reports = await Report.aggregate([
            {
                $addFields: {
                    reportCount: {
                        $cond: {
                           if: { $isArray: "$reportedBy" },
                           then: { $size: "$reportedBy" },
                           else: 0
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'createdBy',
                    foreignField: '_id',
                    as: 'createdByInfo'
                }
            },
            {
                $unwind: {
                    path: '$createdByInfo',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $addFields: {
                    'createdBy.displayName': '$createdByInfo.displayName',
                    'createdBy.image': '$createdByInfo.image'
                }
            },
            {
                $project: {
                    createdByInfo: 0 // Elimina el campo intermedio
                }
            },
            {
                $sort: { createdAt: -1 }
            }
        ]);

        res.json(reports);
    } catch (err) {
        console.error("Error al obtener reportes:", err);
        res.status(500).json({ message: err.message });
    }
});

app.post('/reports', ensureAuth, upload.single('image'), async (req, res) => {
    try {
        const { description, category, coordinates } = req.body;
        const parsedCoords = JSON.parse(coordinates);
        const [lat, lng] = [parsedCoords[0], parsedCoords[1]];
        const municipality = await getMunicipality(lat, lng);

        const newReport = new Report({
            description, category, municipality,
            location: { type: 'Point', coordinates: [lng, lat] },
            imageUrl: req.file ? req.file.path : null,
            createdBy: req.user.id
        });

        const savedReport = await newReport.save();
        io.emit('new_report', savedReport);
        res.status(201).json(savedReport);
    } catch (err) {
        console.error("Error detallado al crear reporte:", err);
        res.status(500).json({ message: 'Error interno del servidor al crear el reporte.' });
    }
});

app.post('/reports/:id/report', ensureAuth, async (req, res) => {
    try {
        const report = await Report.findById(req.params.id);
        if (!report) return res.status(404).json({ message: 'Reporte no encontrado' });
        if (report.reportedBy.includes(req.user.id)) return res.status(400).json({ message: 'Ya has reportado este evento.' });
        report.reportedBy.push(req.user.id);
        await report.save();
        res.json({ message: 'Reporte de abuso enviado' });
    } catch (err) {
        console.error("Error al reportar evento:", err);
        res.status(500).json({ message: 'Error al reportar' });
    }
});

app.delete('/reports/:id', ensureAdmin, async (req, res) => {
    try {
        const report = await Report.findByIdAndDelete(req.params.id);
        if (!report) return res.status(404).json({ message: 'Reporte no encontrado' });
        io.emit('delete_report', req.params.id);
        res.json({ message: 'Reporte eliminado' });
    } catch (err) {
        res.status(500).json({ message: 'Error al eliminar' });
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));