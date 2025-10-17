const mongoose = require('mongoose');

// Categorías temporales que se auto-eliminan
const TEMPORARY_CATEGORIES = {
    'Accidente de Tráfico': 2 * 60 * 60 * 1000,      // 2 horas
    'Fallo Eléctrico': 6 * 60 * 60 * 1000,           // 6 horas
    'Fuga de Agua': 6 * 60 * 60 * 1000,              // 6 horas
    'Emergencia': 4 * 60 * 60 * 1000,                // 4 horas
    'Actividad Social/Cultural': 24 * 60 * 60 * 1000, // 24 horas
    'Otro': 24 * 60 * 60 * 1000 // 24 horas
};

const ReportSchema = new mongoose.Schema({
    description: { 
        type: String, 
        required: true, 
        trim: true,
        maxlength: 500
    },
    category: {
        type: String,
        required: true,
        enum: [
            'Emergencia', 'Ayuda', 'Calle en mal estado', 'Servicio público',
            'Donación de Sangre', 'Aviso Comunitario', 'Actividad Social/Cultural',
            'Mascota Perdida', 'Persona Perdida', 'Accidente de Tráfico', 'Fallo Eléctrico',
            'Fuga de Agua', 'Otro'
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
    }],
    // NUEVO: Sistema de confirmaciones/upvotes
    confirmedBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    // NUEVO: Estado del reporte
    status: {
        type: String,
        enum: ['activo', 'resuelto', 'verificado'],
        default: 'activo'
    },
    // NUEVO: Fecha de expiración automática
    expiresAt: {
        type: Date,
        index: { expires: 0 } // TTL index - MongoDB eliminará automáticamente
    },
    // NUEVO: Prioridad calculada
    priority: {
        type: Number,
        default: 0
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Virtual para contar reportes de abuso
ReportSchema.virtual('reportCount').get(function() {
    return this.reportedBy ? this.reportedBy.length : 0;
});

// Virtual para contar confirmaciones
ReportSchema.virtual('confirmationCount').get(function() {
    return this.confirmedBy ? this.confirmedBy.length : 0;
});

// Índices para mejor rendimiento
ReportSchema.index({ location: '2dsphere' });
ReportSchema.index({ category: 1, createdAt: -1 });
ReportSchema.index({ status: 1 });
ReportSchema.index({ municipality: 1 });

// Middleware: Calcular prioridad antes de guardar
ReportSchema.pre('save', function(next) {
    // Calcular prioridad basada en categoría y confirmaciones
    const categoryPriority = {
        'Emergencia': 100,
        'Accidente de Tráfico': 90,
        'Donación de Sangre': 80,
        'Ayuda': 70,
        'Fallo Eléctrico': 60,
        'Fuga de Agua': 60,
        'Mascota Perdida/Encontrada': 50,
        'Aviso Comunitario': 40,
        'Calle en mal estado': 30,
        'Servicio público': 30,
        'Actividad Social/Cultural': 20,
        'Otro': 10
    };
    
    const basePriority = categoryPriority[this.category] || 10;
    const confirmationBonus = (this.confirmedBy?.length || 0) * 5;
    this.priority = basePriority + confirmationBonus;
    
    next();
});

// Middleware: Configurar auto-eliminación para categorías temporales
ReportSchema.pre('save', function(next) {
    if (this.isNew && TEMPORARY_CATEGORIES[this.category]) {
        const ttlMs = TEMPORARY_CATEGORIES[this.category];
        this.expiresAt = new Date(Date.now() + ttlMs);
    }
    next();
});

// Método estático: Limpiar reportes antiguos manualmente
ReportSchema.statics.cleanupOldReports = async function() {
    const now = new Date();
    const result = await this.deleteMany({
        expiresAt: { $exists: true, $lt: now }
    });
    console.log(`Limpieza automática: ${result.deletedCount} reportes eliminados`);
    return result;
};

// Método de instancia: Marcar como resuelto
ReportSchema.methods.markAsResolved = async function() {
    this.status = 'resuelto';
    return await this.save();
};

// Método de instancia: Verificar reporte
ReportSchema.methods.verify = async function() {
    this.status = 'verificado';
    return await this.save();
};

module.exports = mongoose.model('Report', ReportSchema);