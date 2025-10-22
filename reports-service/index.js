const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");
require('dotenv').config();
const axios = require('axios');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
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
const LocalUser = require('./models/LocalUser'); // NUEVO

const app = express();

// ✅ CONFIGURACIÓN CORS MEJORADA PARA SAFARI/iOS
const allowedOrigins = [
    'http://localhost:3000',
    process.env.FRONTEND_URL
].filter(Boolean);

console.log('Orígenes CORS permitidos:', allowedOrigins);

const corsOptions = {
  origin: function (origin, callback) {
    console.log('Petición recibida del origen:', origin);
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
  maxAge: 86400
};

app.use(cors(corsOptions));
app.use(express.json());

const backendUrl = process.env.NODE_ENV === 'production' 
    ? process.env.BACKEND_URL 
    : 'http://localhost:5000';

if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// ✅ CONFIGURACIÓN DE SESIÓN MEJORADA
app.use(session({
    secret: process.env.SESSION_SECRET || 'secretkey',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        touchAfter: 24 * 3600
    }),
    name: 'actua.sid',
    cookie: {
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        domain: process.env.NODE_ENV === 'production' 
            ? process.env.COOKIE_DOMAIN
            : undefined
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// ✅ ESTRATEGIA LOCAL (Email/Password)
passport.use('local', new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
  },
  async (email, password, done) => {
    try {
        const user = await LocalUser.findOne({ email: email.toLowerCase() });
        if (!user) {
            return done(null, false, { message: 'Email o contraseña incorrectos' });
        }
        
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return done(null, false, { message: 'Email o contraseña incorrectos' });
        }
        
        // Unificar formato de usuario
        return done(null, {
            _id: user._id,
            displayName: user.displayName,
            email: user.email,
            image: user.image || user.getDefaultImage(),
            role: user.role,
            type: 'local'
        });
    } catch (err) {
        return done(err);
    }
  }
));

// ✅ ESTRATEGIA GOOGLE (mejorada para iOS)
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/google/callback`,
    proxy: true,
    // ✅ NUEVO: Parámetros adicionales para iOS Safari
    passReqToCallback: false,
    scope: ['profile', 'email']
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
        
        // Unificar formato
        done(null, {
            _id: user._id,
            displayName: user.displayName,
            email: user.email,
            image: user.image,
            role: user.role,
            type: 'google'
        });
    } catch (err) {
        done(err, null);
    }
  }
));

// ✅ SERIALIZACIÓN MEJORADA (soporta ambos tipos)
passport.serializeUser((user, done) => { 
    done(null, { id: user._id, type: user.type }); 
});

passport.deserializeUser(async (data, done) => {
    try {
        let user;
        if (data.type === 'local') {
            user = await LocalUser.findById(data.id);
            if (user) {
                user = {
                    _id: user._id,
                    displayName: user.displayName,
                    email: user.email,
                    image: user.image || user.getDefaultImage(),
                    role: user.role,
                    type: 'local'
                };
            }
        } else {
            user = await User.findById(data.id);
            if (user) {
                user = {
                    _id: user._id,
                    displayName: user.displayName,
                    email: user.email,
                    image: user.image,
                    role: user.role,
                    type: 'google'
                };
            }
        }
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

// --- RUTAS DE AUTENTICACIÓN LOCAL ---
app.post('/auth/local/register', async (req, res) => {
    try {
        const { email, password, displayName } = req.body;
        
        if (!email || !password || !displayName) {
            return res.status(400).json({ 
                message: 'Todos los campos son requeridos' 
            });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ 
                message: 'La contraseña debe tener al menos 6 caracteres' 
            });
        }
        
        const existingLocal = await LocalUser.findOne({ email: email.toLowerCase() });
        const existingGoogle = await User.findOne({ email: email.toLowerCase() });
        
        if (existingLocal || existingGoogle) {
            return res.status(400).json({ 
                message: 'Este email ya está registrado' 
            });
        }
        
        const newUser = new LocalUser({
            email: email.toLowerCase(),
            password,
            displayName,
            isVerified: true
        });
        
        await newUser.save();
        
        const userObj = {
            _id: newUser._id,
            displayName: newUser.displayName,
            email: newUser.email,
            image: newUser.image || newUser.getDefaultImage(),
            role: newUser.role,
            type: 'local'
        };
        
        req.login(userObj, (err) => {
            if (err) {
                return res.status(500).json({ message: 'Error al iniciar sesión' });
            }
            res.status(201).json({ 
                message: 'Usuario registrado exitosamente',
                user: userObj
            });
        });
        
    } catch (err) {
        console.error('Error en registro:', err);
        res.status(500).json({ message: 'Error al registrar usuario' });
    }
});

app.post('/auth/local/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                message: 'Email y contraseña son requeridos' 
            });
        }
        
        const user = await LocalUser.findOne({ email: email.toLowerCase() });
        
        if (!user) {
            return res.status(401).json({ 
                message: 'Email o contraseña incorrectos' 
            });
        }
        
        const isMatch = await user.comparePassword(password);
        
        if (!isMatch) {
            return res.status(401).json({ 
                message: 'Email o contraseña incorrectos' 
            });
        }
        
        const userObj = {
            _id: user._id,
            displayName: user.displayName,
            email: user.email,
            image: user.image || user.getDefaultImage(),
            role: user.role,
            type: 'local'
        };
        
        req.login(userObj, (err) => {
            if (err) {
                return res.status(500).json({ message: 'Error al iniciar sesión' });
            }
            res.json({ 
                message: 'Inicio de sesión exitoso',
                user: userObj
            });
        });
        
    } catch (err) {
        console.error('Error en login:', err);
        res.status(500).json({ message: 'Error al iniciar sesión' });
    }
});

app.get('/auth/google', passport.authenticate('google', { 
    scope: ['profile', 'email'],
    prompt: 'select_account'
}));

app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/auth/failure' }), 
    (req, res) => {
        res.cookie('auth_success', 'true', { 
            maxAge: 5000, 
            httpOnly: false,
            secure: true,
            sameSite: 'none'
        });
        
        // HTML que cierra el popup
        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Login Exitoso</title></head>
            <body>
                <script>
                    window.close();
                    setTimeout(() => {
                        if (!window.closed) {
                            window.location.href = '${process.env.FRONTEND_URL}';
                        }
                    }, 500);
                </script>
                <p>Autenticación exitosa. Cerrando ventana...</p>
            </body>
            </html>
        `);
    }
);

app.get('/auth/failure', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error de Autenticación</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                    color: white;
                }
                .container { text-align: center; padding: 2rem; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>❌ Error en la autenticación</h2>
                <p>Redirigiendo...</p>
            </div>
            <script>
                if (window.opener) {
                    window.opener.postMessage('login_failure', '*');
                    setTimeout(() => window.close(), 1000);
                } else {
                    window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3000'}';
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/auth/logout', (req, res, next) => { 
    req.logout(err => { 
        if (err) { return next(err); }
        req.session.destroy((err) => {
            res.clearCookie('actua.sid');
            res.json({ message: 'Sesión cerrada' });
        });
    }); 
});

app.get('/auth/me', (req, res) => { 
    res.json(req.user || null); 
});

// --- RUTAS DE REPORTES (sin cambios) ---
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
            createdBy: req.user._id
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
        
        if (report.reportedBy.includes(req.user._id)) {
            return res.status(400).json({ message: 'Ya has reportado este evento.' });
        }
        
        report.reportedBy.push(req.user._id);
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
        
        const userId = req.user._id;
        const alreadyConfirmed = report.confirmedBy.includes(userId);
        
        if (alreadyConfirmed) {
            report.confirmedBy = report.confirmedBy.filter(id => id.toString() !== userId.toString());
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
        
        if (report.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
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

cron.schedule('0 * * * *', async () => {
    console.log('Ejecutando limpieza automática de reportes...');
    try {
        await Report.cleanupOldReports();
    } catch (err) {
        console.error('Error en limpieza automática:', err);
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));