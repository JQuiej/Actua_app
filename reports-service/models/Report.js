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
        enum: [ // <-- ESTA ES LA LISTA CORREGIDA Y COMPLETA
            'Emergencia',
            'Ayuda',
            'Calle en mal estado',
            'Servicio público',
            'Donación de Sangre',
            'Aviso Comunitario',
            'Actividad Social/Cultural',
            'Mascota Perdida/Encontrada',
            'Accidente de Tráfico',
            'Fallo Eléctrico',
            'Fuga de Agua',
            'Otro'
        ],
        default: 'Otro'
    },
    imageUrl: { 
        type: String, 
        required: false
    },
    municipality: { 
        type: String, 
        required: false,
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