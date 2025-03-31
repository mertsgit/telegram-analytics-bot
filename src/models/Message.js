const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  messageId: {
    type: Number,
    required: true
  },
  chatId: {
    type: Number,
    required: true
  },
  chatTitle: {
    type: String,
    required: false
  },
  userId: {
    type: Number,
    required: false
  },
  username: {
    type: String,
    required: false
  },
  firstName: {
    type: String,
    required: false
  },
  lastName: {
    type: String,
    required: false
  },
  text: {
    type: String,
    required: false
  },
  date: {
    type: Date,
    default: Date.now
  },
  analysis: {
    type: Object,
    required: false
  }
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema); 