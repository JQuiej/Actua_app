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
const cron = require('node-cron');

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

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
const User = require('./models/user');

const app = express();

// ✅ CONFIGURACIÓN CORS MEJORADA PARA SAFARI/iOS
const allowedOrigins = [
    'http://localhost:3000',
    process.env.FRONTEND_URL
].filter(Boolean); // Elimina valores undefined

console.log('Orígenes CORS permitidos:', allowedOrigins);

const corsOptions = {
  origin: function (origin, callback) {
    console.log('Petición recibida del origen:', origin);
    // Permitir requests sin origin (mobile apps, Postman, etc)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn('Origen bloqueado por CORS:', origin);
      callback(new Error('Origen no permitido por CORS'));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "DELETE", "PATCH", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["set-cookie"],
  maxAge: 86400 // 24 horas
};

app.use(cors(corsOptions));
app.use(express.json());

const backendUrl = process.env.NODE_ENV === 'production' 
    ? process.env.BACKEND_URL 
    : 'http://localhost:5000';

// ✅ Trust proxy mejorado para producción
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// ✅ CONFIGURACIÓN DE SESIÓN MEJORADA PARA SAFARI/iOS
app.use(session({
    secret: process.env.SESSION_SECRET || 'secretkey',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        touchAfter: 24 * 3600 // Actualizar sesión solo una vez cada 24 horas
    }),
    name: 'actua.sid', // Nombre personalizado de cookie
    cookie: {
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días
        domain: process.env.NODE_ENV === 'production' 
            ? process.env.COOKIE_DOMAIN  // Ej: '.tudominio.com'
            : undefined
    }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/google/callback`,
    proxy: true // ✅ IMPORTANTE para HTTPS en producción
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

const getMunicipality = async (lat, lng) => {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&countrycodes=gt&accept-language=es`;
        const response = await axios.get(url, { 
            headers: { 'User-Agent': 'ActuaApp/1.0' },
            timeout: 5000
        });
        const address = response.data.address;
        return address.city || address.town || address.state_district || 
               address.county || address.state || 'No identificado';
    } catch (error) {
        console.error("Error en Reverse Geocoding:", error.message);
        return 'No identificado';
    }
};

const ensureAuth = (req, res, next) => { 
    if (req.isAuthenticated()) { 
        return next(); 
    } 
    res.status(401).json({ message: 'No autenticado' }); 
};

const ensureAdmin = (req, res, next) => { 
    if (req.isAuthenticated() && req.user.role === 'admin') { 
        return next(); 
    } 
    res.status(403).json({ message: 'Acceso denegado' }); 
};

// --- RUTAS DE AUTENTICACIÓN ---
app.get('/auth/google', passport.authenticate('google', { 
    scope: ['profile', 'email'],
    prompt: 'select_account' // ✅ Forzar selección de cuenta
}));

// ✅ CALLBACK MEJORADO PARA POPUP (Safari/iOS compatible)
app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/auth/failure' }), 
    (req, res) => {
        // En lugar de redirect, enviar HTML que cierra el popup
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Login Exitoso</title>
            </head>
            <body>
                <script>
                    // Notificar a la ventana padre y cerrar popup
                    if (window.opener) {
                        window.opener.postMessage('login_success', '*');
                        window.close();
                    } else {
                        // Si no es popup, redirigir normalmente
                        window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3000'}';
                    }
                </script>
                <p>Autenticación exitosa. Esta ventana se cerrará automáticamente...</p>
            </body>
            </html>
        `);
    }
);

// ✅ NUEVA: Ruta de fallo de autenticación
app.get('/auth/failure', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Error de Autenticación</title>
        </head>
        <body>
            <script>
                if (window.opener) {
                    window.opener.postMessage('login_failure', '*');
                    window.close();
                } else {
                    window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3000'}';
                }
            </script>
            <p>Error en la autenticación. Redirigiendo...</p>
        </body>
        </html>
    `);
});

app.get('/auth/logout', (req, res, next) => { 
    req.logout(err => { 
        if (err) { return next(err); }
        req.session.destroy((err) => {
            res.clearCookie('actua.sid');
            res.redirect(process.env.FRONTEND_URL || 'http://localhost:3000');
        });
    }); 
});

app.get('/auth/me', (req, res) => { 
    res.json(req.user || null); 
});

// --- RUTAS DE REPORTES ---

app.get('/reports', async (req, res) => {
    try {
        const { status, category, municipality } = req.query;
        
        let query = {};
        if (status && status !== 'all') query.status = status;
        if (category && category !== 'Todas') query.category = category;
        if (municipality) query.municipality = municipality;
        
        const reports = await Report.aggregate([
            { $match: query },
            { 
                $addFields: { 
                    reportCount: { 
                        $cond: { 
                            if: { $isArray: "$reportedBy" }, 
                            then: { $size: "$reportedBy" }, 
                            else: 0 
                        } 
                    },
                    confirmationCount: {
                        $cond: {
                            if: { $isArray: "$confirmedBy" },
                            then: { $size: "$confirmedBy" },
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
            { $project: { createdByInfo: 0 } },
            { $sort: { priority: -1, createdAt: -1 } }
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
            description, 
            category, 
            municipality,
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
        
        if (report.reportedBy.includes(req.user.id)) {
            return res.status(400).json({ message: 'Ya has reportado este evento.' });
        }
        
        report.reportedBy.push(req.user.id);
        await report.save();
        
        io.emit('report_updated', report);
        res.json({ message: 'Reporte de abuso enviado' });
    } catch (err) {
        console.error("Error al reportar evento:", err);
        res.status(500).json({ message: 'Error al reportar' });
    }
});

app.post('/reports/:id/confirm', ensureAuth, async (req, res) => {
    try {
        const report = await Report.findById(req.params.id);
        if (!report) return res.status(404).json({ message: 'Reporte no encontrado' });
        
        const userId = req.user.id;
        const alreadyConfirmed = report.confirmedBy.includes(userId);
        
        if (alreadyConfirmed) {
            report.confirmedBy = report.confirmedBy.filter(id => id.toString() !== userId);
        } else {
            report.confirmedBy.push(userId);
        }
        
        await report.save();
        io.emit('report_updated', report);
        
        res.json({ 
            message: alreadyConfirmed ? 'Confirmación removida' : 'Reporte confirmado',
            confirmationCount: report.confirmedBy.length
        });
    } catch (err) {
        console.error("Error al confirmar reporte:", err);
        res.status(500).json({ message: 'Error al confirmar' });
    }
});

app.patch('/reports/:id/resolve', ensureAuth, async (req, res) => {
    try {
        const report = await Report.findById(req.params.id);
        if (!report) return res.status(404).json({ message: 'Reporte no encontrado' });
        
        if (report.createdBy.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'No autorizado' });
        }
        
        await report.markAsResolved();
        io.emit('report_updated', report);
        
        res.json({ message: 'Reporte marcado como resuelto', report });
    } catch (err) {
        console.error("Error al resolver reporte:", err);
        res.status(500).json({ message: 'Error al resolver' });
    }
});

app.delete('/reports/:id', ensureAdmin, async (req, res) => {
    try {
        const report = await Report.findByIdAndDelete(req.params.id);
        if (!report) return res.status(404).json({ message: 'Reporte no encontrado' });
        
        io.emit('delete_report', req.params.id);
        res.json({ message: 'Reporte eliminado' });
    } catch (err) {
        console.error("Error al eliminar:", err);
        res.status(500).json({ message: 'Error al eliminar' });
    }
});

app.get('/stats', async (req, res) => {
    try {
        const totalReports = await Report.countDocuments();
        const activeReports = await Report.countDocuments({ status: 'activo' });
        const resolvedReports = await Report.countDocuments({ status: 'resuelto' });
        
        const reportsByCategory = await Report.aggregate([
            { $match: { status: 'activo' } },
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);
        
        const recentActivity = await Report.find()
            .sort({ createdAt: -1 })
            .limit(10)
            .select('category createdAt municipality');
        
        res.json({
            total: totalReports,
            active: activeReports,
            resolved: resolvedReports,
            byCategory: reportsByCategory,
            recentActivity
        });
    } catch (err) {
        console.error("Error obteniendo estadísticas:", err);
        res.status(500).json({ message: 'Error al obtener estadísticas' });
    }
});

// --- TAREA PROGRAMADA ---
cron.schedule('0 * * * *', async () => {
    console.log('Ejecutando limpieza automática de reportes...');
    try {
        await Report.cleanupOldReports();
    } catch (err) {
        console.error('Error en limpieza automática:', err);
    }
});

// ✅ HEALTH CHECK
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));