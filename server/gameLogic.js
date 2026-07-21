// ─── Game Logic ───────────────────────────────────────────────────────────────
// Server-authoritative UNO rules engine.
// Deck building, shuffling, dealing, turn management, special cards,
// stacking, UNO call/catch, win detection, elimination, wild challenge,
// shuffle-hands, draw pile reshuffling.
//
// The engine is mode-agnostic: it reads a flat, normalized settings object
// (see public/shared/game-modes.js). New rules are added by reading a new
// settings key here — modes themselves live entirely in the registry.
// ──────────────────────────────────────────────────────────────────────────────

const GameModes = require('../public/shared/game-modes');

const COLORS = ['red', 'blue', 'green', 'yellow'];
const ACTIONS = ['skip', 'reverse', 'draw2'];

// Wild draw families for the stacking matrix: draw2 is its own family,
// wild4/wild8 share the "wild draw" family.
const WILD_DRAW_TYPES = new Set(['wild4', 'wild8']);
const DRAW_AMOUNTS = { draw2: 2, wild4: 4, wild8: 8 };

let cardIdCounter = 0;

function makeCard(color, type, value) {
  return { id: cardIdCounter++, color, type, value };
}

function isWild(card) {
  return card.color === 'wild';
}

// ─── Deck Construction ────────────────────────────────────────────────────────

function buildSingleDeck(settings) {
  const cards = [];

  for (const color of COLORS) {
    // Number 0: ×1 per color
    cards.push(makeCard(color, 'number', 0));
    // Numbers 1–9: ×2 per color
    for (let n = 1; n <= 9; n++) {
      cards.push(makeCard(color, 'number', n));
      cards.push(makeCard(color, 'number', n));
    }
    // Action cards: ×2 per color
    for (const action of ACTIONS) {
      cards.push(makeCard(color, action, action));
      cards.push(makeCard(color, action, action));
    }
  }

  // Wild ×4
  for (let i = 0; i < 4; i++) {
    cards.push(makeCard('wild', 'wild', 'wild'));
  }
  // Wild Draw Four ×4
  for (let i = 0; i < 4; i++) {
    cards.push(makeCard('wild', 'wild4', 'wild4'));
  }
  // Wild +8 ×2 (rule-gated)
  if (settings.wildDraw8) {
    for (let i = 0; i < 2; i++) {
      cards.push(makeCard('wild', 'wild8', 'wild8'));
    }
  }
  // Wild Shuffle Hands ×2 (rule-gated)
  if (settings.shuffleHands) {
    for (let i = 0; i < 2; i++) {
      cards.push(makeCard('wild', 'shuffle', 'shuffle'));
    }
  }

  return cards;
}

function buildDeck(playerCount, settings) {
  cardIdCounter = 0;
  const deck = buildSingleDeck(settings);
  if (playerCount > 10) {
    deck.push(...buildSingleDeck(settings));
  }
  // Safety top-up: large tables + big starting hands must never exhaust the
  // deck during the deal (e.g. 20 players × 10 cards).
  const needed = playerCount * (settings.startingCards || 7) + 30;
  while (deck.length < needed) {
    deck.push(...buildSingleDeck(settings));
  }
  return deck;
}

// ─── Fisher-Yates Shuffle ─────────────────────────────────────────────────────

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Game Initialization ──────────────────────────────────────────────────────

function initGame(players, rawSettings) {
  const settings = GameModes.normalizeSettings(rawSettings);
  const playerCount = players.length;
  const deck = shuffle(buildDeck(playerCount, settings));
  const startingCards = settings.startingCards || 7;

  // Deal starting hand to each player
  const hands = {};
  for (const player of players) {
    hands[player.id] = deck.splice(0, startingCards);
  }

  // Flip first valid discard card (never a wild of any kind)
  let discardPile = [];
  let discardTop = null;
  while (deck.length > 0) {
    const card = deck.shift();
    if (isWild(card)) {
      // Put it back somewhere in the deck and reshuffle
      deck.push(card);
      shuffle(deck);
    } else {
      discardTop = card;
      discardPile.push(card);
      break;
    }
  }

  // Apply first card effects
  let currentPlayerIndex = 0;
  let direction = 1; // 1 = clockwise, -1 = counter-clockwise
  let activeColor = discardTop.color;

  // If first card is an action card, apply its effect
  if (discardTop.type === 'skip') {
    currentPlayerIndex = nextPlayerIndex(currentPlayerIndex, direction, playerCount);
  } else if (discardTop.type === 'reverse') {
    if (playerCount === 2) {
      // Acts as skip with 2 players
      currentPlayerIndex = nextPlayerIndex(currentPlayerIndex, direction, playerCount);
    } else {
      direction *= -1;
      // Current player changes to last player in new direction
      currentPlayerIndex = nextPlayerIndex(playerCount - 1, direction, playerCount);
    }
  } else if (discardTop.type === 'draw2') {
    // First player draws 2 and gets skipped
    const drawCards = deck.splice(0, 2);
    hands[players[currentPlayerIndex].id].push(...drawCards);
    currentPlayerIndex = nextPlayerIndex(currentPlayerIndex, direction, playerCount);
  }

  // Per-game stats: feed the post-game panel, leaderboard, and achievements
  const stats = { startedAt: Date.now(), perPlayer: {} };
  for (const p of players) {
    stats.perPlayer[p.id] = { cardsPlayed: 0, cardsDrawn: 0, wildsPlayed: 0, maxHand: hands[p.id].length };
  }

  return {
    hands,
    drawPile: deck,
    discardPile,
    discardTop,
    activeColor,
    currentPlayerIndex,
    direction,
    playerCount,
    playerIds: players.map(p => p.id),
    settings,
    pendingDraw: 0,        // accumulated draw from stacking
    pendingDrawType: null,  // 'draw2' | 'wild4' | 'wild8'
    challenge: null,        // { targetId, byPlayerId, wasIllegal } while a +4 is challengeable
    eliminatedIds: [],      // players knocked out by the elimination rule
    finishOrder: [],        // Play-for-Places: playerIds in the order they emptied their hand (best→)
    unoState: {},           // playerId → { called: bool, timestamp }
    winner: null,
    turnTimestamp: Date.now(),
    stats,
  };
}

// ─── Turn Helpers ─────────────────────────────────────────────────────────────

function nextPlayerIndex(current, direction, playerCount) {
  return ((current + direction) % playerCount + playerCount) % playerCount;
}

function advanceTurn(state) {
  state.currentPlayerIndex = nextPlayerIndex(
    state.currentPlayerIndex,
    state.direction,
    state.playerCount
  );
  state.turnTimestamp = Date.now();
}

function getCurrentPlayerId(state) {
  return state.playerIds[state.currentPlayerIndex];
}

// ─── Draw Pile Reshuffle ──────────────────────────────────────────────────────

function ensureDrawPile(state, needed) {
  if (state.drawPile.length >= needed) return;

  // Nothing recyclable: the discard holds only the face-up top card (or is
  // somehow empty). Popping here would set discardTop to undefined and corrupt
  // every later playability check, so bail and let drawCards short-draw.
  if (state.discardPile.length <= 1) return;

  // Take all discard except top card
  const top = state.discardPile.pop();
  const reshuffled = shuffle(state.discardPile);
  state.drawPile.push(...reshuffled);
  state.discardPile = [top];
}

function drawCards(state, playerId, count) {
  ensureDrawPile(state, count);
  const actual = Math.min(count, state.drawPile.length);
  const drawn = state.drawPile.splice(0, actual);
  state.hands[playerId].push(...drawn);
  // stats may be absent on games restored from an older save format
  const ps = state.stats && state.stats.perPlayer[playerId];
  if (ps) {
    ps.cardsDrawn += drawn.length;
    ps.maxHand = Math.max(ps.maxHand, state.hands[playerId].length);
  }
  return drawn;
}

// ─── Elimination ──────────────────────────────────────────────────────────────
// With the elimination rule on, a player whose hand reaches the limit is out:
// their cards return to the draw pile, they leave the turn order, and the
// last player standing wins. Returns null when nothing happened, otherwise
// { eliminated: playerId, winner: playerId|null }.

function checkElimination(state, playerId) {
  const s = state.settings;
  if (!s.elimination) return null;
  const hand = state.hands[playerId];
  if (!hand || hand.length < (s.eliminationLimit || 25)) return null;

  state.eliminatedIds.push(playerId);
  const result = removePlayerFromGame(state, playerId);
  return { eliminated: playerId, winner: result.winner || null };
}

// ─── Card Validation ──────────────────────────────────────────────────────────

function isPlayable(card, state) {
  const s = state.settings;

  // A draw stack is pending: only cards allowed by the stacking matrix.
  if (state.pendingDraw > 0) {
    const t = state.pendingDrawType;
    const sameFamily = (t === 'draw2' && card.type === 'draw2') ||
      (WILD_DRAW_TYPES.has(t) && WILD_DRAW_TYPES.has(card.type));

    if (card.type === 'draw2') return sameFamily ? !!s.stackDraw2 : !!s.stackMix;
    if (WILD_DRAW_TYPES.has(card.type)) return sameFamily ? !!s.stackDraw4 : !!s.stackMix;
    // Skip/Reverse can defuse a stack when their color matches the pile
    if (card.type === 'skip') return !!s.stackSkip && card.color === state.activeColor;
    if (card.type === 'reverse') return !!s.stackReverse && card.color === state.activeColor;
    return false;
  }

  // Wild cards are always playable when no stack is pending
  if (isWild(card)) return true;

  // Same color
  if (card.color === state.activeColor) return true;
  // Same number
  if (card.type === 'number' && state.discardTop.type === 'number' && card.value === state.discardTop.value) return true;
  // Same action type
  if (card.type !== 'number' && card.type === state.discardTop.type) return true;

  return false;
}

// Can the next player respond to a draw card instead of eating it?
// Decides whether the penalty resolves instantly (snappy) or goes pending.
function stackResponsePossible(state, cardType) {
  const s = state.settings;
  if (s.stackSkip || s.stackReverse || s.stackMix) return true;
  if (cardType === 'draw2') return !!s.stackDraw2;
  if (WILD_DRAW_TYPES.has(cardType)) return !!s.stackDraw4;
  return false;
}

// ─── Seven-Zero Helpers ───────────────────────────────────────────────────────

// 0 played: every hand moves to the next player in the direction of play.
function rotateHands(state) {
  const oldHands = state.hands;
  const newHands = {};
  for (let i = 0; i < state.playerIds.length; i++) {
    const from = state.playerIds[i];
    const to = state.playerIds[nextPlayerIndex(i, state.direction, state.playerCount)];
    newHands[to] = oldHands[from];
  }
  state.hands = newHands;
  // Hands changed owners — pending UNO catches no longer make sense
  state.unoState = {};
  bumpMaxHandStats(state, state.playerIds);
}

// 7 played: the player swaps hands with a chosen opponent.
function swapHands(state, a, b) {
  [state.hands[a], state.hands[b]] = [state.hands[b], state.hands[a]];
  delete state.unoState[a];
  delete state.unoState[b];
  bumpMaxHandStats(state, [a, b]);
}

// Wild Shuffle Hands: collect every active hand, shuffle, redeal round-robin
// starting with the player after whoever played the card.
function shuffleAllHands(state, playedById) {
  const pool = [];
  for (const pid of state.playerIds) {
    pool.push(...(state.hands[pid] || []));
    state.hands[pid] = [];
  }
  shuffle(pool);

  const startIdx = nextPlayerIndex(state.playerIds.indexOf(playedById), state.direction, state.playerCount);
  let i = 0;
  while (pool.length > 0) {
    const pid = state.playerIds[(startIdx + i) % state.playerCount];
    state.hands[pid].push(pool.pop());
    i++;
  }

  // Fresh UNO state: anyone now holding one card gets a fresh (called) entry —
  // being shuffled to one card isn't a failure to call UNO.
  state.unoState = {};
  for (const pid of state.playerIds) {
    if (state.hands[pid].length === 1) {
      state.unoState[pid] = { called: true, timestamp: Date.now() };
    }
  }
  bumpMaxHandStats(state, state.playerIds);
}

function bumpMaxHandStats(state, playerIds) {
  if (!state.stats) return;
  for (const pid of playerIds) {
    const ps = state.stats.perPlayer[pid];
    if (ps) ps.maxHand = Math.max(ps.maxHand, (state.hands[pid] || []).length);
  }
}

// Jump-in rule: a card is jump-in playable only as an EXACT copy of the top card
function isExactMatch(card, top) {
  if (!top || card.color === 'wild' || top.color === 'wild') return false;
  if (card.color !== top.color) return false;
  if (card.type === 'number') return top.type === 'number' && card.value === top.value;
  return card.type === top.type;
}

// ─── Play Card ────────────────────────────────────────────────────────────────

function playCard(state, playerId, cardId, chosenColor, swapTargetId) {
  const s = state.settings;
  const isJumpIn = getCurrentPlayerId(state) !== playerId;

  // Validate it's this player's turn — unless the jump-in rule lets them
  // slam an identical card out of turn
  if (isJumpIn) {
    if (!s.jumpIn) {
      return { error: "It's not your turn" };
    }
    if (state.pendingDraw > 0) {
      return { error: 'Cannot jump in while a draw stack is pending' };
    }
    const jumpHand = state.hands[playerId];
    const jumpCard = jumpHand && jumpHand.find(c => c.id === cardId);
    if (!jumpCard) {
      return { error: 'Card not in your hand' };
    }
    if (!isExactMatch(jumpCard, state.discardTop)) {
      return { error: 'You can only jump in with an identical card' };
    }
    // Jump-in steals the turn — play then proceeds from this player
    state.currentPlayerIndex = state.playerIds.indexOf(playerId);
    state.turnTimestamp = Date.now();
  }

  // Find card in hand
  const hand = state.hands[playerId];
  const cardIndex = hand ? hand.findIndex(c => c.id === cardId) : -1;
  if (cardIndex === -1) {
    return { error: 'Card not in your hand' };
  }

  const card = hand[cardIndex];

  // Validate playability
  if (!isPlayable(card, state)) {
    return {
      error: state.pendingDraw > 0
        ? 'You must draw the penalty cards first'
        : 'This card cannot be played right now',
    };
  }

  // Validate chosen color for wild cards (wild, wild4, wild8, shuffle)
  if (isWild(card) && !COLORS.includes(chosenColor)) {
    return { error: 'You must choose a color' };
  }

  // Seven-Zero: playing a 7 (that isn't the winning card) requires choosing
  // a valid opponent to swap hands with. Validate BEFORE mutating anything.
  const needsSwapTarget = s.sevenZero && card.type === 'number' &&
    card.value === 7 && hand.length > 1;
  if (needsSwapTarget) {
    if (!swapTargetId || swapTargetId === playerId || !state.playerIds.includes(swapTargetId)) {
      return { error: 'Choose a player to swap hands with', needsSwapTarget: true };
    }
  }

  // Wild Challenge bookkeeping: was this +4 "illegal" (player held a color
  // match)? Must be captured BEFORE the card leaves the hand.
  const prevActiveColor = state.activeColor;
  const wild4WasIllegal = card.type === 'wild4' &&
    hand.some(c => c.id !== card.id && c.color === prevActiveColor);

  // Remove card from hand
  hand.splice(cardIndex, 1);

  const ps = state.stats && state.stats.perPlayer[playerId];
  if (ps) {
    ps.cardsPlayed++;
    if (card.color === 'wild') ps.wildsPlayed++;
    // Per-type counts feed achievements and challenges (rewards engine)
    ps.typeCounts = ps.typeCounts || {};
    ps.typeCounts[card.type] = (ps.typeCounts[card.type] || 0) + 1;
  }

  // Place on discard pile
  state.discardPile.push(card);
  state.discardTop = card;

  // Any successful play voids an open +4 challenge window
  state.challenge = null;

  // Track UNO state: if player now has 1 card, start UNO timer
  if (hand.length === 1) {
    state.unoState[playerId] = { called: false, timestamp: Date.now() };
  } else {
    delete state.unoState[playerId];
  }

  // Build result
  const result = {
    card,
    effects: [],
    nextPlayer: null,
    winner: null,
  };

  if (isJumpIn) {
    result.effects.push({ type: 'jump_in', playerId });
  }

  // Check win / finish
  if (hand.length === 0) {
    if (s.playForPlaces) {
      // Play-for-Places: emptying your hand secures your placement but the
      // round continues for everyone else until one player is left. The last
      // card's action effect is not applied (same as a normal winning card).
      const fin = recordFinish(state, playerId);
      result.finished = playerId;
      result.place = fin.place;
      result.effects.push({ type: 'finished', playerId, place: fin.place });
      if (fin.gameOver) {
        // Only one player remains — the round is fully decided.
        result.winner = state.winner; // = first finisher (set by recordFinish)
        result.standings = computeStandings(state);
        result.effects.push({ type: 'game_complete', standings: result.standings });
      } else {
        result.nextPlayer = getCurrentPlayerId(state);
      }
      return result;
    }
    // Default: the first player out wins and the round ends immediately.
    state.winner = playerId;
    result.winner = playerId;
    return result;
  }

  const dodgingStack = state.pendingDraw > 0; // skip/reverse defusing a stack

  // Helper: resolve a draw penalty immediately (no stacking response possible)
  const resolveDrawNow = (amount) => {
    advanceTurn(state);
    const targetId = getCurrentPlayerId(state);
    const drawn = drawCards(state, targetId, amount);
    result.effects.push({ type: 'draw', playerId: targetId, count: drawn.length });
    const elim = checkElimination(state, targetId);
    if (elim) {
      result.effects.push({ type: 'eliminated', playerId: elim.eliminated });
      if (elim.winner) {
        state.winner = elim.winner;
        result.winner = elim.winner;
        return;
      }
      // Elimination already handed the turn to the next player
    } else {
      result.effects.push({ type: 'skip', playerId: targetId });
      advanceTurn(state);
    }
  };

  // Helper: add to the pending stack
  const addToStack = (amount, type) => {
    state.pendingDraw += amount;
    state.pendingDrawType = type;
    advanceTurn(state);
    result.effects.push({ type: 'pending_draw', count: state.pendingDraw, targetId: getCurrentPlayerId(state) });
  };

  // Apply card effects
  switch (card.type) {
    case 'number':
      state.activeColor = card.color;
      if (s.sevenZero && card.value === 0) {
        rotateHands(state);
        result.effects.push({ type: 'hands_rotated', direction: state.direction });
      } else if (needsSwapTarget) {
        swapHands(state, playerId, swapTargetId);
        result.effects.push({ type: 'hands_swapped', a: playerId, b: swapTargetId });
      }
      advanceTurn(state);
      break;

    case 'skip':
      state.activeColor = card.color;
      if (dodgingStack) {
        // Skip Dodge: the whole pending pile passes to the next player
        advanceTurn(state);
        result.effects.push({
          type: 'stack_passed', via: 'skip', playerId,
          targetId: getCurrentPlayerId(state), count: state.pendingDraw,
        });
      } else {
        advanceTurn(state); // skip the next player
        result.effects.push({ type: 'skip', playerId: getCurrentPlayerId(state) });
        advanceTurn(state); // move to player after them
      }
      break;

    case 'reverse':
      state.activeColor = card.color;
      state.direction *= -1;
      result.effects.push({ type: 'reverse', direction: state.direction });
      if (dodgingStack) {
        // Reverse Bounce: the pile heads back where it came from
        advanceTurn(state);
        result.effects.push({
          type: 'stack_passed', via: 'reverse', playerId,
          targetId: getCurrentPlayerId(state), count: state.pendingDraw,
        });
      } else {
        // Always flip direction regardless of player count.
        // With 2 players this gives the turn to the other player (previous).
        advanceTurn(state);
      }
      break;

    case 'draw2':
      state.activeColor = card.color;
      if (stackResponsePossible(state, 'draw2')) {
        addToStack(2, 'draw2');
      } else {
        resolveDrawNow(2);
      }
      break;

    case 'wild':
      state.activeColor = chosenColor;
      advanceTurn(state);
      result.effects.push({ type: 'color_change', color: chosenColor });
      break;

    case 'wild4': {
      state.activeColor = chosenColor;
      result.effects.push({ type: 'color_change', color: chosenColor });
      // A fresh (unstacked) +4 opens a challenge window for its target
      const challengeable = s.wildChallenge && state.pendingDraw === 0;
      if (challengeable || stackResponsePossible(state, 'wild4')) {
        addToStack(4, 'wild4');
        if (challengeable) {
          state.challenge = {
            targetId: getCurrentPlayerId(state),
            byPlayerId: playerId,
            wasIllegal: wild4WasIllegal,
          };
        }
      } else {
        resolveDrawNow(4);
      }
      break;
    }

    case 'wild8':
      state.activeColor = chosenColor;
      result.effects.push({ type: 'color_change', color: chosenColor });
      if (stackResponsePossible(state, 'wild8')) {
        addToStack(8, 'wild8');
      } else {
        resolveDrawNow(8);
      }
      break;

    case 'shuffle':
      state.activeColor = chosenColor;
      result.effects.push({ type: 'color_change', color: chosenColor });
      shuffleAllHands(state, playerId);
      result.effects.push({ type: 'hands_shuffled', playerId });
      advanceTurn(state);
      break;
  }

  result.nextPlayer = getCurrentPlayerId(state);
  return result;
}

// ─── Draw Card (player chooses to draw) ───────────────────────────────────────

function playerDrawCard(state, playerId) {
  const s = state.settings;
  if (getCurrentPlayerId(state) !== playerId) {
    return { error: "It's not your turn" };
  }

  // If there's a pending draw (stack the player can't or won't answer)
  if (state.pendingDraw > 0) {
    const count = state.pendingDraw;
    state.pendingDraw = 0;
    state.pendingDrawType = null;
    state.challenge = null; // accepting the cards closes the challenge window
    const drawn = drawCards(state, playerId, count);

    const elim = checkElimination(state, playerId);
    if (elim) {
      return {
        drawn, count: drawn.length, forced: true,
        eliminated: elim.eliminated, winner: elim.winner,
        nextPlayer: state.winner ? null : getCurrentPlayerId(state),
      };
    }
    advanceTurn(state);
    return { drawn, count: drawn.length, forced: true, nextPlayer: getCurrentPlayerId(state) };
  }

  // Force Play: drawing is not allowed while holding a playable card
  if (s.forcePlay && (state.hands[playerId] || []).some(c => isPlayable(c, state))) {
    return { error: 'Force Play is on — you must play a playable card' };
  }

  // Draw-to-match: keep drawing until a playable card turns up (hard-capped so
  // a dead deck can't loop forever). Turn does not advance — player may then
  // play the matched card or pass.
  if (s.drawToMatch) {
    const drawn = [];
    const MAX_DRAW_TO_MATCH = 25;
    while (drawn.length < MAX_DRAW_TO_MATCH) {
      const d = drawCards(state, playerId, 1);
      if (d.length === 0) break; // deck + discard exhausted
      drawn.push(d[0]);
      // Elimination can trigger mid-draw — stop immediately
      const elim = checkElimination(state, playerId);
      if (elim) {
        return {
          drawn, count: drawn.length, forced: false,
          eliminated: elim.eliminated, winner: elim.winner,
          nextPlayer: state.winner ? null : getCurrentPlayerId(state),
        };
      }
      if (isPlayable(d[0], state)) break;
    }
    return { drawn, count: drawn.length, forced: false, mustPass: true };
  }

  // Normal draw: draw 1 card, but DO NOT advance the turn yet.
  // Player must explicitly pass (or play the drawn card).
  const drawn = drawCards(state, playerId, 1);
  const elim = checkElimination(state, playerId);
  if (elim) {
    return {
      drawn, count: drawn.length, forced: false,
      eliminated: elim.eliminated, winner: elim.winner,
      nextPlayer: state.winner ? null : getCurrentPlayerId(state),
    };
  }
  return { drawn, count: drawn.length, forced: false, mustPass: true };
}

// ─── Wild Challenge ───────────────────────────────────────────────────────────
// The target of a fresh +4 may challenge instead of drawing. If the +4 was
// illegal (player held a color match), the offender draws the 4 and the
// challenger keeps their turn. Otherwise the challenger draws 6 (4 + 2).

function challengeWild4(state, challengerId) {
  const ch = state.challenge;
  if (!ch || ch.targetId !== challengerId) {
    return { error: 'Nothing to challenge' };
  }
  if (getCurrentPlayerId(state) !== challengerId) {
    return { error: "It's not your turn" };
  }

  state.challenge = null;
  state.pendingDraw = 0;
  state.pendingDrawType = null;

  const result = {
    success: true,
    guilty: ch.wasIllegal,
    challengerId,
    offenderId: ch.byPlayerId,
    effects: [],
  };

  const loserId = ch.wasIllegal ? ch.byPlayerId : challengerId;
  const count = ch.wasIllegal ? 4 : 6;
  const drawn = drawCards(state, loserId, count);
  result.count = drawn.length;
  result.loserId = loserId;
  result.effects.push({ type: 'draw', playerId: loserId, count: drawn.length });

  const elim = checkElimination(state, loserId);
  if (elim) {
    result.effects.push({ type: 'eliminated', playerId: elim.eliminated });
    if (elim.winner) {
      state.winner = elim.winner;
      result.winner = elim.winner;
      return result;
    }
  }

  // Guilty offender: challenger keeps the turn. Failed challenge: the
  // challenger eats 6 and their turn is skipped (unless elimination already
  // advanced the order for us).
  if (!ch.wasIllegal && !elim) {
    advanceTurn(state);
  }

  result.nextPlayer = getCurrentPlayerId(state);
  return result;
}

// ─── Pass Turn (after drawing) ────────────────────────────────────────────────

function passTurn(state, playerId) {
  if (getCurrentPlayerId(state) !== playerId) {
    return { error: "It's not your turn" };
  }
  advanceTurn(state);
  return { success: true, nextPlayer: getCurrentPlayerId(state) };
}

// ─── UNO Call ─────────────────────────────────────────────────────────────────

function callUno(state, playerId) {
  if (state.unoState[playerId]) {
    state.unoState[playerId].called = true;
    return { success: true };
  }
  return { error: 'No UNO to call' };
}

function catchUno(state, catcherId, targetId) {
  const unoEntry = state.unoState[targetId];
  if (!unoEntry) {
    return { error: 'Target has not triggered UNO' };
  }
  if (unoEntry.called) {
    return { error: 'Player already called UNO' };
  }

  const elapsed = Date.now() - unoEntry.timestamp;

  // Grace period: give the player a host-configured window (100–1000ms) to
  // press their own UNO button before anyone else is allowed to catch and
  // fine them. Falls back to 500ms for games predating the setting.
  const graceMs = (state.settings && state.settings.unoGraceMs) || 500;
  if (catcherId !== targetId && elapsed < graceMs) {
    return { error: 'Grace period active' };
  }

  // Check timing — within 6 seconds total
  if (elapsed > 6000) {
    return { error: 'Too late to catch' };
  }

  // Penalty: target draws 2
  const drawn = drawCards(state, targetId, 2);
  delete state.unoState[targetId];

  const result = { success: true, drawn, targetId };
  const elim = checkElimination(state, targetId);
  if (elim) {
    result.eliminated = elim.eliminated;
    result.winner = elim.winner;
  }
  return result;
}

// ─── Get Game State (public, safe to broadcast) ──────────────────────────────

function getPublicState(state) {
  const cardCounts = {};
  for (const pid of state.playerIds) {
    cardCounts[pid] = state.hands[pid] ? state.hands[pid].length : 0;
  }

  return {
    discardTop: state.discardTop,
    activeColor: state.activeColor,
    currentPlayer: getCurrentPlayerId(state),
    direction: state.direction,
    cardCounts,
    drawPileCount: state.drawPile.length,
    pendingDraw: state.pendingDraw,
    pendingDrawType: state.pendingDrawType,
    eliminatedIds: state.eliminatedIds || [],
    // Play-for-Places: who has already finished (so reconnecting clients and
    // still-playing clients can render placements live)
    finishOrder: state.finishOrder || [],
    // Challenge window: expose WHO can challenge but never whether the +4
    // was legal — that's the whole gamble.
    challenge: state.challenge
      ? { targetId: state.challenge.targetId, byPlayerId: state.challenge.byPlayerId }
      : null,
    // Winner rides along in every state snapshot so clients that missed the
    // transient player_won event (disconnected tab during an AFK auto-play,
    // refresh right at game end) still learn the game is over on reconnect.
    winner: state.winner || null,
    unoState: Object.fromEntries(
      Object.entries(state.unoState).map(([k, v]) => [k, { called: v.called }])
    ),
  };
}

// ─── Play-for-Places ──────────────────────────────────────────────────────────
// A player emptied their hand while the Play-for-Places rule is on. Record
// their placement, pull them out of the turn order (the game continues), and
// report gameOver when only one player is left. The FIRST finisher is the
// winner for stats/leaderboard purposes.

function recordFinish(state, playerId) {
  if (!state.finishOrder) state.finishOrder = [];
  state.finishOrder.push(playerId);
  const place = state.finishOrder.length; // 1-based finishing position

  const res = removePlayerFromGame(state, playerId);
  if (res.winner) {
    // removePlayerFromGame set state.winner to the LAST remaining player when
    // one was left; for Play-for-Places the true winner is the first finisher.
    state.lastPlaceId = res.winner;
    state.winner = state.finishOrder[0];
    return { place, gameOver: true };
  }
  return { place, gameOver: false };
}

// Final standings, best → worst: finishers in the order they went out, then
// any players still holding cards, then players knocked out by the cap
// (earliest-eliminated ranks worst). Returns an array of playerIds.
function computeStandings(state) {
  const standings = [...(state.finishOrder || [])];
  for (const pid of state.playerIds) {
    if (!standings.includes(pid)) standings.push(pid);
  }
  for (const pid of [...(state.eliminatedIds || [])].reverse()) {
    if (!standings.includes(pid)) standings.push(pid);
  }
  return standings;
}

// ─── Remove Player Mid-Game ───────────────────────────────────────────────────
// Called when a player is kicked/surrenders during an active game, and by the
// elimination rule. Removes them from playerIds, hands, adjusts
// currentPlayerIndex, and returns { winner } if only one player is left.

function removePlayerFromGame(state, kickedPlayerId) {
  const kickedIdx = state.playerIds.indexOf(kickedPlayerId);
  if (kickedIdx === -1) return { notInGame: true };

  // Remove from playerIds and return their cards to the draw pile (reshuffled)
  state.playerIds.splice(kickedIdx, 1);
  state.playerCount = state.playerIds.length;
  const kickedHand = state.hands[kickedPlayerId] || [];
  state.drawPile.push(...kickedHand);
  shuffle(state.drawPile);
  delete state.hands[kickedPlayerId];
  delete state.unoState[kickedPlayerId];

  // A pending challenge involving this player is void
  if (state.challenge &&
      (state.challenge.targetId === kickedPlayerId || state.challenge.byPlayerId === kickedPlayerId)) {
    state.challenge = null;
  }

  // Only one player left → that player wins
  if (state.playerCount === 1) {
    const winnerId = state.playerIds[0];
    state.winner = winnerId;
    return { winner: winnerId };
  }

  // Fix currentPlayerIndex:
  // - If we removed an entry before (or at) the current index, shift back
  // - Clamp to valid range just in case
  if (kickedIdx < state.currentPlayerIndex) {
    state.currentPlayerIndex -= 1;
  } else if (kickedIdx === state.currentPlayerIndex) {
    // It was this player's turn — wrap to the now-current slot
    // (after the splice, index N points to the next player already)
    state.currentPlayerIndex = state.currentPlayerIndex % state.playerCount;
    state.turnTimestamp = Date.now();
  }
  // Clamp
  state.currentPlayerIndex =
    ((state.currentPlayerIndex % state.playerCount) + state.playerCount) % state.playerCount;

  return { winner: null };
}

module.exports = {
  initGame,
  playCard,
  playerDrawCard,
  challengeWild4,
  passTurn,
  callUno,
  catchUno,
  isPlayable,
  getPublicState,
  getCurrentPlayerId,
  removePlayerFromGame,
  computeStandings,
  COLORS,
};
