const mongoose = require('mongoose');

// Cada documento representa un grupo de chat.
// ownerPhone   → teléfono del creador del grupo
// members      → array de teléfonos de los miembros (incluye al creador)
// name         → nombre del grupo
// avatar       → emoji o URL de imagen del grupo (opcional)
const GroupSchema = new mongoose.Schema({

    groupId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    name: {
        type: String,
        required: true
    },

    ownerPhone: {
        type: String,
        required: true
    },

    members: [{
        type: String,
        required: true
    }],

    avatar: {
        type: String,
        default: null
    },

    createdAt: {
        type: Date,
        default: Date.now
    }

});

module.exports = mongoose.model('Group', GroupSchema);