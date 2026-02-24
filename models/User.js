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
    }

});

module.exports = mongoose.model('User', UserSchema);