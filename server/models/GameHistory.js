const mongoose = require('mongoose');

// One document per finished game, written from recordGameEnd in index.js —
// the single funnel every win path (normal play, kick, forfeit) goes through.
const gameHistorySchema = new mongoose.Schema({
  roomCode: { type: String, required: true },
  isPrivate: { type: Boolean, default: false },
  winnerName: { type: String, default: 'Unknown' },
  winnerIsBot: { type: Boolean, default: false },
  players: [{
    _id: false,
    nickname: String,
    isBot: Boolean,
    won: Boolean,
    cardsPlayed: Number,
    cardsDrawn: Number,
    wildsPlayed: Number,
  }],
  humanCount: { type: Number, default: 0 },
  botCount: { type: Number, default: 0 },
  durationMs: { type: Number, default: 0 },
  // Active house rules at game end (stacking/jumpIn/sevenZero/drawToMatch)
  rules: [{ type: String }],
  ts: { type: Date, default: Date.now }, // indexed via the TTL index below
}, {
  versionKey: false
});

// Same retention as raw visits — keep 180 days of game history
gameHistorySchema.index({ ts: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

const GameHistory = mongoose.model('GameHistory', gameHistorySchema);
module.exports = GameHistory;
