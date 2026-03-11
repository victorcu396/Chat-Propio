const mongoose = require('mongoose');

// Cada documento representa UN contacto guardado por UN usuario.
// ownerPhone   → el teléfono del usuario que guardó el contacto
// contactPhone → el teléfono del usuario guardado
// customName   → el nombre personalizado que el dueño le puso
const ContactSchema = new mongoose.Schema({

    ownerPhone: {
        type: String,
        required: true,
        index: true
    },

    contactPhone: {
        type: String,
        required: true
    },

    customName: {
        type: String,
        required: true
    },

    createdAt: {
        type: Date,
        default: Date.now
    }

});

// Evitar duplicados: un usuario no puede tener el mismo contacto dos veces
ContactSchema.index({ ownerPhone: 1, contactPhone: 1 }, { unique: true });

module.exports = mongoose.model('Contact', ContactSchema);