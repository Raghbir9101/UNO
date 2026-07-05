// ─── Mailer ───────────────────────────────────────────────────────────────────
// Sends transactional email (password resets) via SMTP. Configured entirely
// from env vars; when SMTP isn't configured, senders return false and callers
// fall back gracefully (the reset link is logged to the server console so an
// admin can still help a player manually).
//
// .env keys: SMTP_HOST, SMTP_PORT (587 default), SMTP_USER, SMTP_PASS,
//            SMTP_FROM (defaults to SMTP_USER)
// Gmail works with an App Password: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465.
// ──────────────────────────────────────────────────────────────────────────────

const nodemailer = require('nodemailer');

let transport = null;
const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  const port = Number(SMTP_PORT) || 587;
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  console.log(`[mail] SMTP configured via ${SMTP_HOST}:${port}`);
} else {
  console.warn('[mail] SMTP not configured — password reset emails disabled (links will be logged instead)');
}

const isConfigured = () => !!transport;

async function sendPasswordReset(to, username, link) {
  if (!transport) return false;
  try {
    await transport.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to,
      subject: 'Reset your Play UNO Free password',
      text: `Hi ${username},\n\nSomeone (hopefully you) asked to reset the password for your Play UNO Free account.\n\nReset it here (link valid for 1 hour):\n${link}\n\nIf you didn't ask for this, you can safely ignore this email — your password is unchanged.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;">
          <h2 style="color:#e33;">🃏 Play UNO Free</h2>
          <p>Hi <strong>${username}</strong>,</p>
          <p>Someone (hopefully you) asked to reset the password for your Play UNO Free account.</p>
          <p style="margin:28px 0;">
            <a href="${link}" style="background:#e33;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a>
          </p>
          <p style="color:#666;font-size:13px;">This link is valid for 1 hour. If you didn't ask for this, ignore this email — your password is unchanged.</p>
        </div>`,
    });
    return true;
  } catch (err) {
    console.error('[mail] send failed:', err.message);
    return false;
  }
}

module.exports = { isConfigured, sendPasswordReset };
