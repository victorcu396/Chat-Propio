const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    id: {
        type:     String,
        required: true,
        index:    true
    },
    conversationId: {
        type:     String,
        required: true,
        index:    true
    },
    from: {
        type:     String,
        required: true
    },
    to: {
        type:    String,
        default: null
    },
    message: {
        type:    String,
        default: ''
    },
    // Imagen en base64 (opcional)
    imageData: {
        type:    String,
        default: null
    },
    avatar: {
        type:     String,
        required: true
    },
    time: {
        type:    Date,
        default: Date.now
    },
    delivered: {
        type:    Boolean,
        default: false
    },
    read: {
        type:    Boolean,
        default: false
    }
});

module.exports = mongoose.model('Message', MessageSchema);