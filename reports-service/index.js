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

require('dotenv').config();

// --- LOG DE DIAGNÓSTICO ---
console.log("--- VARIABLES DE ENTORNO EN PRODUCCIÓN ---");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("FRONTEND_URL:", process.env.FRONTEND_URL);
console.log("BACKEND_URL:", process.env.BACKEND_URL);
console.log("-----------------------------------------");

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

// --- CONFIGURACIÓN DE CORS DEFINITIVA ---
// Lista explícita de orígenes permitidos
const allowedOrigins = [
    'http://localhost:3000',
    process.env.FRONTEND_URL 
];

console.log('Orígenes CORS permitidos:', allowedOrigins); // Log de depuración

const corsOptions = {
  origin: function (origin, callback) {
    // Log para ver qué origen está pidiendo acceso
    console.log('Petición recibida del origen:', origin);

    // Permitir si el origen está en la lista o si no hay origen (como Postman)
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      callback(new Error('Origen no permitido por CORS'));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "DELETE"]
};

app.use(cors(corsOptions));
// --- FIN DE LA CONFIGURACIÓN DE CORS ---

app.use(express.json());

const backendUrl = process.env.NODE_ENV === 'production' ? process.env.BACKEND_URL : 'http://localhost:5000';

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
const io = new Server(server, { cors: corsOptions });

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Conexión a MongoDB exitosa"))
    .catch(err => console.error("Error de conexión a MongoDB:", err));

// ... (El resto del archivo no necesita cambios)
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
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: process.env.FRONTEND_URL || 'http://localhost:3000' }), (req, res) => res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000'));
app.get('/auth/logout', (req, res, next) => { req.logout(err => { if (err) { return next(err); } res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000'); }); });
app.get('/auth/me', (req, res) => { res.json(req.user || null); });

app.get('/reports', async (req, res) => {
    try {
        const reports = await Report.aggregate([
            { $addFields: { reportCount: { $cond: { if: { $isArray: "$reportedBy" }, then: { $size: "$reportedBy" }, else: 0 } } } },
            { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'createdByInfo' } },
            { $unwind: { path: '$createdByInfo', preserveNullAndEmptyArrays: true } },
            { $addFields: { 'createdBy.displayName': '$createdByInfo.displayName', 'createdBy.image': '$createdByInfo.image' } },
            { $project: { createdByInfo: 0 } },
            { $sort: { createdAt: -1 } }
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