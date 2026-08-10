// ─── Voice Chat (LiveKit client) ──────────────────────────────────────────────
// Per-room audio for the players at a table plus any God Mode spectator
// watching it. The SDK is only fetched the first time someone actually joins
// voice, so players who never touch the mic button pay nothing for it.
//
// Mic starts muted every time: a public card game is the last place you want a
// hot mic the instant the page loads.
// ──────────────────────────────────────────────────────────────────────────────

window.Voice = (function () {
  'use strict';

  const SDK_URL = 'https://cdn.jsdelivr.net/npm/livekit-client@2/dist/livekit-client.umd.min.js';

  let sdkPromise = null;
  let room = null;
  let status = 'off';        // off | connecting | connected | error
  let muted = true;
  let micDenied = false;
  let audioBlocked = false;  // browser refused autoplay until a gesture
  let roomCode = null;
  const speaking = new Set(); // identities currently talking

  // Remote audio elements live in a hidden container rather than being
  // attached to player seats — the seats are canvas-drawn, not DOM nodes.
  let audioHost = null;
  function getAudioHost() {
    if (!audioHost) {
      audioHost = document.createElement('div');
      audioHost.id = 'voice-audio';
      audioHost.style.display = 'none';
      document.body.appendChild(audioHost);
    }
    return audioHost;
  }

  const listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function emitChange() {
    const snap = getState();
    listeners.forEach(fn => { try { fn(snap); } catch (e) { console.error('[voice]', e); } });
  }

  function getState() {
    return {
      status,
      muted,
      micDenied,
      audioBlocked,
      roomCode,
      participants: listParticipants(),
    };
  }

  function listParticipants() {
    if (!room) return [];
    const out = [];
    const local = room.localParticipant;
    if (local) {
      out.push({
        identity: local.identity,
        name: local.name || 'You',
        isLocal: true,
        muted,
        speaking: speaking.has(local.identity) && !muted,
      });
    }
    room.remoteParticipants?.forEach(p => {
      out.push({
        identity: p.identity,
        name: p.name || p.identity,
        isLocal: false,
        muted: !p.isMicrophoneEnabled,
        speaking: speaking.has(p.identity),
      });
    });
    return out;
  }

  function loadSdk() {
    if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.async = true;
      s.onload = () => window.LivekitClient
        ? resolve(window.LivekitClient)
        : reject(new Error('LiveKit SDK loaded but missing'));
      s.onerror = () => {
        sdkPromise = null; // let a later attempt retry the download
        reject(new Error('Could not download the voice chat library'));
      };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  function wireRoomEvents(LK) {
    const E = LK.RoomEvent;

    room.on(E.TrackSubscribed, (track, _pub, participant) => {
      if (track.kind !== LK.Track.Kind.Audio) return;
      const el = track.attach();
      el.dataset.identity = participant.identity;
      el.autoplay = true;
      getAudioHost().appendChild(el);
      emitChange();
    });

    room.on(E.TrackUnsubscribed, (track) => {
      track.detach().forEach(el => el.remove());
      emitChange();
    });

    room.on(E.ActiveSpeakersChanged, (speakers) => {
      speaking.clear();
      speakers.forEach(p => speaking.add(p.identity));
      emitChange();
    });

    room.on(E.ParticipantConnected, emitChange);
    room.on(E.ParticipantDisconnected, emitChange);
    room.on(E.TrackMuted, emitChange);
    room.on(E.TrackUnmuted, emitChange);

    room.on(E.AudioPlaybackStatusChanged, () => {
      audioBlocked = !room.canPlaybackAudio;
      emitChange();
    });

    room.on(E.Disconnected, () => {
      teardown();
      emitChange();
    });
  }

  function teardown() {
    if (audioHost) audioHost.innerHTML = '';
    speaking.clear();
    room = null;
    status = 'off';
    muted = true;
    micDenied = false;
    audioBlocked = false;
    roomCode = null;
  }

  /**
   * Ask the server for a token and connect. Resolves to a result object rather
   * than throwing so callers can show one toast and move on.
   */
  async function join(socket, code) {
    if (status === 'connecting' || status === 'connected') return { ok: true };

    status = 'connecting';
    roomCode = code;
    emitChange();

    const grant = await new Promise(resolve => {
      let settled = false;
      const done = (r) => { if (!settled) { settled = true; resolve(r); } };
      socket.emit('voice_token', { roomCode: code }, done);
      setTimeout(() => done({ error: 'Voice server did not respond' }), 10000);
    });

    if (!grant || grant.enabled === false) {
      teardown();
      emitChange();
      return { ok: false, error: 'Voice chat is not available on this server' };
    }
    if (grant.error || !grant.token) {
      teardown();
      emitChange();
      return { ok: false, error: grant.error || 'Could not start voice chat' };
    }

    let LK;
    try {
      LK = await loadSdk();
    } catch (err) {
      teardown();
      emitChange();
      return { ok: false, error: err.message };
    }

    try {
      room = new LK.Room({
        adaptiveStream: false,          // audio-only: nothing to adapt
        dynacast: true,
        stopLocalTrackOnUnpublish: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      wireRoomEvents(LK);
      await room.connect(grant.url, grant.token);
    } catch (err) {
      console.error('[voice] connect failed', err);
      if (room) { try { await room.disconnect(); } catch { /* already gone */ } }
      teardown();
      status = 'error';
      emitChange();
      return { ok: false, error: 'Could not reach the voice server' };
    }

    status = 'connected';

    // Publish the mic up front but muted, so the permission prompt happens on
    // the click that started this and unmuting later is instant.
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      await room.localParticipant.setMicrophoneEnabled(false);
      muted = true;
      micDenied = false;
    } catch (err) {
      console.warn('[voice] microphone unavailable', err);
      micDenied = true;
      muted = true;
    }

    // Safari/Chrome may hold remote audio until a gesture — this call is
    // already inside one.
    try { await room.startAudio(); } catch { /* retried on next tap */ }
    audioBlocked = !room.canPlaybackAudio;

    emitChange();
    return { ok: true, micDenied };
  }

  async function leave() {
    if (!room) { teardown(); emitChange(); return; }
    try { await room.disconnect(); } catch { /* nothing to clean up */ }
    teardown();
    emitChange();
  }

  async function setMuted(next) {
    if (!room || status !== 'connected') return { ok: false };
    try {
      await room.localParticipant.setMicrophoneEnabled(!next);
      muted = next;
      micDenied = false;
      emitChange();
      return { ok: true };
    } catch (err) {
      console.warn('[voice] mic toggle failed', err);
      micDenied = true;
      muted = true;
      emitChange();
      return { ok: false, error: 'Microphone permission is blocked in your browser' };
    }
  }

  function toggleMute() { return setMuted(!muted); }

  // Called from a click when the browser blocked remote audio playback.
  async function resumeAudio() {
    if (!room) return;
    try {
      await room.startAudio();
      audioBlocked = !room.canPlaybackAudio;
      emitChange();
    } catch { /* stays blocked until the next gesture */ }
  }

  return {
    join,
    leave,
    setMuted,
    toggleMute,
    resumeAudio,
    onChange,
    getState,
    get status() { return status; },
    get muted() { return muted; },
    get active() { return status === 'connected'; },
  };
})();
