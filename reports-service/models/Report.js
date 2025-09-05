const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
    description: { 
        type: String, 
        required: true, 
        trim: true 
    },
    category: {
        type: String,
        required: true,
        enum: ['Emergencia', 'Ayuda', 'Calle en mal estado', 'Servicio público', 'Otro'],
        default: 'Otro'
    },
    // --- CAMPO AÑADIDO: Para la URL de la imagen de Cloudinary ---
    imageUrl: { 
        type: String, 
        required: false // Es opcional, no todos los reportes tendrán imagen
    },
    // --- CAMPO AÑADIDO: Para el municipio obtenido con reverse geocoding ---
    municipality: { 
        type: String, 
        required: false, // Es opcional para que la app no falle si no se puede obtener
        trim: true 
    },
    location: {
        type: { 
            type: String, 
            enum: ['Point'], 
            required: true 
        },
        coordinates: { 
            type: [Number], // [longitud, latitud]
            required: true 
        }
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

ReportSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Report', ReportSchema);