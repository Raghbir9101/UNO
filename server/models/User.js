const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  // Unique — a registered username is reserved on the leaderboard
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 2,
    maxlength: 16
  },
  // Absent for Google-only accounts
  password: {
    type: String,
    required: function () { return !this.googleId; }
  },
  googleId: {
    type: String,
    index: true,
    sparse: true
  },
  // Active avatar: Google photo URL or 'emoji:X' from the profile page
  picture: {
    type: String
  },
  // The Google photo URL, kept separately so users can switch back to it
  // after trying an emoji avatar
  googlePicture: {
    type: String
  },
  // Links the account to the anonymous stats identity (statsStore uid).
  // This is what makes stats cross-device: on login the client adopts this uid.
  uid: {
    type: String,
    index: true
  },
  wins: {
    type: Number,
    default: 0
  },
  gamesPlayed: {
    type: Number,
    default: 0
  },
  lastLoginAt: {
    type: Date
  },
  // Password reset: sha256 of the emailed token + expiry (1 hour)
  resetTokenHash: {
    type: String,
    index: true,
    sparse: true
  },
  resetTokenExpires: {
    type: Date
  }
}, {
  timestamps: true
});

const User = mongoose.model('User', userSchema);
module.exports = User;
