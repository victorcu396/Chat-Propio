const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true
    },
    conversationId: { 
        type: String,
        required: true
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
        required: true
    },
    avatar:{
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
    }
});

module.exports = mongoose.model('Message', MessageSchema);