const mongoose = require('mongoose');

// Cloud copy of a player's progression (coins/XP/inventory/challenges) and
// lifetime stats, keyed by the same uid the file stores use. Written through
// on every change (debounced) and read back on login, so a signed-in player's
// data survives redeploys and follows them to any device/server.
const playerProgressSchema = new mongoose.Schema({
  uid: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    default: 'Player',
  },
  // Full progressStore record (coins, xp, level, streaks, challenges, inventory, equipped)
  progress: {
    type: mongoose.Schema.Types.Mixed,
  },
  // Full statsStore record (wins, gamesPlayed, achievements, weekly bucket)
  stats: {
    type: mongoose.Schema.Types.Mixed,
  },
}, {
  timestamps: true,
  minimize: false, // keep empty objects like equipped: {}
});

const PlayerProgress = mongoose.model('PlayerProgress', playerProgressSchema);
module.exports = PlayerProgress;
