const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");
require('dotenv').config();
const axios = require('axios');

// Configuración para subida de imágenes
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

const app = express();

// --- CONFIGURACIÓN DE CORS MEJORADA ---
// Lista de orígenes permitidos. Se leerá desde las variables de entorno.
const allowedOrigins = (process.env.FRONTEND_URL || '').split(',').concat('http://localhost:3000');

const corsOptions = {
  origin: function (origin, callback) {
    // Si el origen está en nuestra lista de permitidos (o si no hay origen, como en las peticiones de Postman), se permite.
    if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
      callback(null, true);
    } else {
      // Si el origen no está permitido, se rechaza la petición.
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST"]
};

app.use(cors(corsOptions));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { 
  cors: { 
    origin: allowedOrigins, 
    methods: ["GET", "POST"] 
  } 
});


mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Conexión a MongoDB exitosa"))
    .catch(err => console.error("Error de conexión a MongoDB:", err));

// --- FUNCIÓN DE GEOLOCALIZACIÓN CORREGIDA ---
const getMunicipality = async (lat, lng) => {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&countrycodes=gt&accept-language=es`;
        
        // ¡ACCIÓN IMPORTANTE! La política de Nominatim requiere un User-Agent único.
        // Reemplaza el email de ejemplo con tu propio email real.
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'ActuaApp/1.0 (tu.email.real@ejemplo.com)' } 
        });
        
        const address = response.data.address;
        return address.city || address.town || address.state_district || address.county || address.state || 'No identificado';
    } catch (error) {
        // Si esta función falla, no queremos que crashee el servidor.
        console.error("Error en Reverse Geocoding:", error.message);
        return 'No identificado'; // Devolvemos un valor por defecto.
    }
};

// Endpoint para OBTENER todos los reportes
app.get('/reports', async (req, res) => {
    try {
        const reports = await Report.find().sort({ createdAt: -1 });
        res.json(reports);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Endpoint para CREAR un reporte
app.post('/reports', upload.single('image'), async (req, res) => {
    try {
        const { description, category, coordinates } = req.body;
        const parsedCoords = JSON.parse(coordinates);

        if (!description || !category || !parsedCoords) {
            return res.status(400).json({ message: 'Faltan datos requeridos.' });
        }

        const lat = parsedCoords[0];
        const lng = parsedCoords[1];
        const municipality = await getMunicipality(lat, lng);

        const newReport = new Report({
            description,
            category,
            municipality,
            location: { type: 'Point', coordinates: [lng, lat] },
            imageUrl: req.file ? req.file.path : null
        });

        const savedReport = await newReport.save();
        io.emit('new_report', savedReport);
        res.status(201).json(savedReport);

    } catch (err) {
        // Este log es crucial para ver el error exacto en Render
        console.error("Error detallado al crear reporte:", err);
        res.status(500).json({ message: 'Error interno del servidor al crear el reporte.' });
    }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Servidor corriendo en el puerto ${PORT}`));