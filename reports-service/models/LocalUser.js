const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const LocalUserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Por favor ingresa un email válido']
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    displayName: {
        type: String,
        required: true,
        trim: true
    },
    image: {
        type: String,
        default: null
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    verificationToken: String,
    resetPasswordToken: String,
    resetPasswordExpires: Date
}, { timestamps: true });

// Hash password antes de guardar
LocalUserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) {
        next(err);
    }
});

// Método para comparar passwords
LocalUserSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Generar URL de imagen por defecto
LocalUserSchema.methods.getDefaultImage = function() {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(this.displayName)}&background=2563eb&color=fff&size=128`;
};

module.exports = mongoose.model('LocalUser', LocalUserSchema);