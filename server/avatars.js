// ─── Avatar Definitions ───────────────────────────────────────────────────────
// A player's `picture` is one of:
//   - a Google profile photo URL (lh3-lh6.googleusercontent.com, validated)
//   - 'emoji:X' where X is from this whitelist (picked on the profile page)
//   - null → default colored letter/dot avatar
// Keep AVATAR_EMOJIS in sync with the copy in public/main.js.
// ──────────────────────────────────────────────────────────────────────────────

const AVATAR_EMOJIS = [
  '😀', '😎', '🤠', '🥳', '😈', '👻', '👽', '🤖',
  '🐱', '🐶', '🦊', '🐼', '🦁', '🐸', '🐙', '🦄',
  '🐯', '🐵', '🔥', '⚡', '🌟', '🎯', '🃏', '👑',
];

// Shop avatars (cosmetics registry) are also valid picture emojis — ownership
// is enforced in the shop UI; the whitelist only guards against arbitrary input
const COSMETIC_EMOJIS = require('../public/shared/cosmetics').avatarEmojis();
const ALL_AVATAR_EMOJIS = [...AVATAR_EMOJIS, ...COSMETIC_EMOJIS];

const GOOGLE_PHOTO_RE = /^https:\/\/lh[3-6]\.googleusercontent\.com\/[\w\-./=%]{1,256}$/;

// Returns the sanitized picture value, or null if not acceptable
function sanitizePicture(value) {
  if (typeof value !== 'string') return null;
  if (GOOGLE_PHOTO_RE.test(value)) return value;
  if (value.startsWith('emoji:') && ALL_AVATAR_EMOJIS.includes(value.slice(6))) return value;
  return null;
}

module.exports = { AVATAR_EMOJIS, sanitizePicture, GOOGLE_PHOTO_RE };
