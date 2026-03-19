const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({

    id: {
        type: String,
        required: true,
        index: true
    },

    conversationId: {
        type: String,
        required: true,
        index: true
    },

    from: {
        type: String,
        required: true
    },

    to: {
        type: String,
        default: null
    },

    message: {
        type: String,
        default: ''
    },

    imageData: {
        type: String,
        default: null
    },

    // Audio grabado desde el chat (base64 webm/ogg/mp4)
    audioData: {
        type: String,
        default: null
    },

    avatar: {
        type: String,
        required: true
    },

    time: {
        type: Date,
        default: Date.now
    },

    delivered: {
        type: Boolean,
        default: false
    },

    read: {
        type: Boolean,
        default: false
    },

    // ── Edición ──────────────────────────────────────────────
    editedAt: {
        type: Date,
        default: null
    },

    // ── Borrado ──────────────────────────────────────────────
    // Borrado suave: se conserva en BD pero el contenido se oculta
    deletedAt: {
        type: Date,
        default: null
    },

    // ── Respuesta (reply) ─────────────────────────────────────
    replyToId: {
        type: String,
        default: null
    },
    replyToFrom: {
        type: String,
        default: null
    },
    replyToText: {
        type: String,
        default: null
    },

    // ── Reenvío ───────────────────────────────────────────────
    forwardedFrom: {
        type: String,
        default: null
    },

    // ── Reacciones ────────────────────────────────────────────
    // { emoji: [username, username, ...] }
    reactions: {
        type: Map,
        of: [String],
        default: {}
    },

    // ── Destacado ─────────────────────────────────────────────
    // Array de usernames que han destacado este mensaje
    starredBy: {
        type: [String],
        default: []
    },

    // ── Hilo (thread) ─────────────────────────────────────────
    threadId: {
        type: String,
        default: null  // null = mensaje normal; valor = ID del mensaje raíz del hilo
    },
    threadCount: {
        type: Number,
        default: 0
    },

    // ── Autodestrucción ───────────────────────────────────────
    // Fecha en que el mensaje debe eliminarse (null = no expira)
    expiresAt: {
        type: Date,
        default: null,
        index: true
    },

    // ── Audio escuchado ───────────────────────────────────────
    // Array de usernames que ya escucharon el audio
    audioReadBy: {
        type: [String],
        default: []
    },

    // ── Menciones ────────────────────────────────────────────
    // Array de usernames mencionados con @ en el mensaje
    mentions: {
        type: [String],
        default: []
    }

});

module.exports = mongoose.model('Message', MessageSchema);