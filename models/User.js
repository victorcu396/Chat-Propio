const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({

    phone: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    username: {
        type: String,
        required: true
    },

    avatar: {
        type: String,
        required: true
    },

    createdAt: {
        type: Date,
        default: Date.now
    },

    lastLogin: {
        type: Date,
        default: Date.now
    },

    // Array de teléfonos que este usuario ha bloqueado
    blockedPhones: {
        type: [String],
        default: []
    },

    // Suscripciones Web Push (puede haber varias: móvil, PC, tablet...)
    pushSubscriptions: {
        type: [mongoose.Schema.Types.Mixed],
        default: []
    }

});

module.exports = mongoose.model('User', UserSchema);