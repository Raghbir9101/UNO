// ─── Voice Chat (LiveKit) ─────────────────────────────────────────────────────
// Mints short-lived LiveKit access tokens so a room's players (and God Mode
// spectators) can talk to each other. The SFU itself runs as a separate
// service — see DEPLOYMENT.md. With the LIVEKIT_* env vars unset the whole
// feature reports itself as disabled and the game behaves exactly as before.
// ──────────────────────────────────────────────────────────────────────────────

const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const LIVEKIT_URL = (process.env.LIVEKIT_URL || '').trim();
const API_KEY = (process.env.LIVEKIT_API_KEY || '').trim();
const API_SECRET = (process.env.LIVEKIT_API_SECRET || '').trim();

// Tokens outlive a long game but not a whole day, so a leaked one expires on
// its own. Clients re-request on every (re)join.
const TOKEN_TTL = '3h';

const configured = Boolean(LIVEKIT_URL && API_KEY && API_SECRET);

if (!configured) {
  console.log('[voice] LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set — voice chat disabled');
} else {
  console.log(`[voice] LiveKit enabled at ${LIVEKIT_URL}`);
}

// RoomServiceClient speaks HTTP even though clients connect over ws(s)://
const httpUrl = LIVEKIT_URL.replace(/^ws/, 'http');
let roomService = null;
function svc() {
  if (!configured) return null;
  if (!roomService) roomService = new RoomServiceClient(httpUrl, API_KEY, API_SECRET);
  return roomService;
}

function isConfigured() {
  return configured;
}

/**
 * The voice room name for a game room. Prefixed so a LiveKit deployment shared
 * with anything else can't have its room names collide with ours.
 */
function voiceRoomName(roomCode) {
  return `uno-${roomCode}`;
}

/**
 * Mint a join token. `identity` must be the stable playerId — LiveKit kicks the
 * older session when the same identity connects twice, which is exactly the
 * behaviour we want on a refresh.
 */
async function createToken({ roomCode, playerId, nickname }) {
  if (!configured) return null;

  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: playerId,
    name: nickname,
    ttl: TOKEN_TTL,
  });

  at.addGrant({
    roomJoin: true,
    room: voiceRoomName(roomCode),
    canPublish: true,     // God Mode spectators talk too, so this is never false
    canSubscribe: true,
    canPublishData: false, // game traffic stays on socket.io
  });

  return at.toJwt();
}

/**
 * Hard-disconnect someone from the voice room. Used on kick/leave so a removed
 * player can't keep talking until their token expires. Best-effort: a LiveKit
 * outage must never break leaving a game room.
 */
async function removeParticipant(roomCode, playerId) {
  const client = svc();
  if (!client) return;
  try {
    await client.removeParticipant(voiceRoomName(roomCode), playerId);
  } catch (err) {
    // 404 just means they were never connected to voice
    const msg = String(err && err.message || err);
    if (!/not found|does not exist/i.test(msg)) {
      console.warn(`[voice] removeParticipant(${roomCode}, ${playerId}) failed: ${msg}`);
    }
  }
}

module.exports = {
  isConfigured,
  voiceRoomName,
  createToken,
  removeParticipant,
  url: LIVEKIT_URL,
};
