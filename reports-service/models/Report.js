const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
    description: { type: String, required: true, trim: true },
    category: {
        type: String,
        required: true,
        enum: [
            'Emergencia', 'Ayuda', 'Calle en mal estado', 'Servicio público',
            'Donación de Sangre', 'Aviso Comunitario', 'Actividad Social/Cultural',
            'Mascota Perdida/Encontrada', 'Accidente de Tráfico', 'Fallo Eléctrico',
            'Fuga de Agua', 'Otro'
        ],
        default: 'Otro'
    },
    imageUrl: { type: String, required: false },
    municipality: { type: String, required: false, trim: true },
    location: {
        type: { type: String, enum: ['Point'], required: true },
        coordinates: { type: [Number], required: true }
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reportedBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }]
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

ReportSchema.virtual('reportCount').get(function() {
  return this.reportedBy ? this.reportedBy.length : 0;
});

ReportSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Report', ReportSchema);