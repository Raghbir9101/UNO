// ─── Game Logic ───────────────────────────────────────────────────────────────
// Server-authoritative UNO rules engine.
// Deck building, shuffling, dealing, turn management, special cards,
// stacking, UNO call/catch, win detection, draw pile reshuffling.
// ──────────────────────────────────────────────────────────────────────────────

const COLORS = ['red', 'blue', 'green', 'yellow'];
const NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const ACTIONS = ['skip', 'reverse', 'draw2'];

let cardIdCounter = 0;

function makeCard(color, type, value) {
  return { id: cardIdCounter++, color, type, value };
}

// ─── Deck Construction ────────────────────────────────────────────────────────

function buildSingleDeck() {
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
  // Wild +8 ×2 (custom)
  for (let i = 0; i < 2; i++) {
    cards.push(makeCard('wild', 'wild8', 'wild8'));
  }

  return cards; // 110 cards
}

function buildDeck(playerCount) {
  cardIdCounter = 0;
  const deck = buildSingleDeck();
  if (playerCount > 10) {
    deck.push(...buildSingleDeck());
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

function initGame(players, settings) {
  const playerCount = players.length;
  const deck = shuffle(buildDeck(playerCount));

  // Deal 7 cards to each player
  const hands = {};
  for (const player of players) {
    hands[player.id] = deck.splice(0, 7);
  }

  // Flip first valid discard card (not Wild/+4/+8)
  let discardPile = [];
  let discardTop = null;
  while (deck.length > 0) {
    const card = deck.shift();
    if (card.type === 'wild' || card.type === 'wild4' || card.type === 'wild8') {
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
    unoState: {},           // playerId → { called: bool, timestamp }
    winner: null,
    turnTimestamp: Date.now(),
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
  return drawn;
}

// ─── Card Validation ──────────────────────────────────────────────────────────

function isPlayable(card, state) {
  // If there's a pending draw stack, only matching draw type or forced draw
  if (state.pendingDraw > 0 && state.settings.stacking) {
    if (state.pendingDrawType === 'draw2' && card.type === 'draw2') return true;
    if (state.pendingDrawType === 'wild4' && card.type === 'wild4') return true;
    if (state.pendingDrawType === 'wild8' && card.type === 'wild8') return true;
    return false;
  }

  // Wild cards are always playable (when no forced stack)
  if (card.type === 'wild' || card.type === 'wild4' || card.type === 'wild8') {
    // If pending draw and stacking OFF, can't play
    if (state.pendingDraw > 0 && !state.settings.stacking) return false;
    return true;
  }

  // Same color
  if (card.color === state.activeColor) return true;
  // Same number
  if (card.type === 'number' && state.discardTop.type === 'number' && card.value === state.discardTop.value) return true;
  // Same action type
  if (card.type !== 'number' && card.type === state.discardTop.type) return true;

  return false;
}

// ─── Play Card ────────────────────────────────────────────────────────────────

function playCard(state, playerId, cardId, chosenColor) {
  // Validate it's this player's turn
  if (getCurrentPlayerId(state) !== playerId) {
    return { error: "It's not your turn" };
  }

  // If pending draw and stacking is OFF, must draw
  if (state.pendingDraw > 0 && !state.settings.stacking) {
    return { error: 'You must draw cards first' };
  }

  // Find card in hand
  const hand = state.hands[playerId];
  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) {
    return { error: 'Card not in your hand' };
  }

  const card = hand[cardIndex];

  // Validate playability
  if (!isPlayable(card, state)) {
    return { error: 'This card cannot be played right now' };
  }

  // Validate chosen color for wild cards
  if ((card.type === 'wild' || card.type === 'wild4' || card.type === 'wild8') && !COLORS.includes(chosenColor)) {
    return { error: 'You must choose a color' };
  }

  // Remove card from hand
  hand.splice(cardIndex, 1);

  // Place on discard pile
  state.discardPile.push(card);
  state.discardTop = card;

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

  // Check win
  if (hand.length === 0) {
    state.winner = playerId;
    result.winner = playerId;
    return result;
  }

  // Apply card effects
  switch (card.type) {
    case 'number':
      state.activeColor = card.color;
      advanceTurn(state);
      break;

    case 'skip':
      state.activeColor = card.color;
      advanceTurn(state); // skip the next player
      result.effects.push({ type: 'skip', playerId: getCurrentPlayerId(state) });
      advanceTurn(state); // move to player after them
      break;

    case 'reverse':
      state.activeColor = card.color;
      // Always flip direction regardless of player count.
      // With 2 players this gives the turn to the other player (previous).
      state.direction *= -1;
      result.effects.push({ type: 'reverse', direction: state.direction });
      advanceTurn(state);
      break;

    case 'draw2':
      state.activeColor = card.color;
      if (state.settings.stacking) {
        state.pendingDraw += 2;
        state.pendingDrawType = 'draw2';
        advanceTurn(state);
        result.effects.push({ type: 'pending_draw', count: state.pendingDraw, targetId: getCurrentPlayerId(state) });
      } else {
        advanceTurn(state);
        const targetId = getCurrentPlayerId(state);
        const drawn = drawCards(state, targetId, 2);
        result.effects.push({ type: 'draw', playerId: targetId, count: drawn.length });
        result.effects.push({ type: 'skip', playerId: targetId });
        advanceTurn(state);
      }
      break;

    case 'wild':
      state.activeColor = chosenColor;
      advanceTurn(state);
      result.effects.push({ type: 'color_change', color: chosenColor });
      break;

    case 'wild4':
      state.activeColor = chosenColor;
      result.effects.push({ type: 'color_change', color: chosenColor });
      if (state.settings.stacking) {
        state.pendingDraw += 4;
        state.pendingDrawType = 'wild4';
        advanceTurn(state);
        result.effects.push({ type: 'pending_draw', count: state.pendingDraw, targetId: getCurrentPlayerId(state) });
      } else {
        advanceTurn(state);
        const targetId = getCurrentPlayerId(state);
        const drawn = drawCards(state, targetId, 4);
        result.effects.push({ type: 'draw', playerId: targetId, count: drawn.length });
        result.effects.push({ type: 'skip', playerId: targetId });
        advanceTurn(state);
      }
      break;

    case 'wild8':
      state.activeColor = chosenColor;
      result.effects.push({ type: 'color_change', color: chosenColor });
      if (state.settings.stacking) {
        state.pendingDraw += 8;
        state.pendingDrawType = 'wild8';
        advanceTurn(state);
        result.effects.push({ type: 'pending_draw', count: state.pendingDraw, targetId: getCurrentPlayerId(state) });
      } else {
        advanceTurn(state);
        const targetId = getCurrentPlayerId(state);
        const drawn = drawCards(state, targetId, 8);
        result.effects.push({ type: 'draw', playerId: targetId, count: drawn.length });
        result.effects.push({ type: 'skip', playerId: targetId });
        advanceTurn(state);
      }
      break;
  }

  result.nextPlayer = getCurrentPlayerId(state);
  return result;
}

// ─── Draw Card (player chooses to draw) ───────────────────────────────────────

function playerDrawCard(state, playerId) {
  if (getCurrentPlayerId(state) !== playerId) {
    return { error: "It's not your turn" };
  }

  // If there's a pending draw (stacking scenario where player can't stack)
  if (state.pendingDraw > 0) {
    const count = state.pendingDraw;
    state.pendingDraw = 0;
    state.pendingDrawType = null;
    const drawn = drawCards(state, playerId, count);
    advanceTurn(state);
    return { drawn, count: drawn.length, forced: true, nextPlayer: getCurrentPlayerId(state) };
  }

  // Normal draw: draw 1 card, but DO NOT advance the turn yet.
  // Player must explicitly pass (or play the drawn card in future).
  const drawn = drawCards(state, playerId, 1);
  return { drawn, count: drawn.length, forced: false, mustPass: true };
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

  // Check timing — within 2 seconds + current turn
  const elapsed = Date.now() - unoEntry.timestamp;
  if (elapsed > 5000) {
    return { error: 'Too late to catch' };
  }

  // Penalty: target draws 2
  const drawn = drawCards(state, targetId, 2);
  delete state.unoState[targetId];
  return { success: true, drawn, targetId };
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
    unoState: Object.fromEntries(
      Object.entries(state.unoState).map(([k, v]) => [k, { called: v.called }])
    ),
  };
}

module.exports = {
  initGame,
  playCard,
  playerDrawCard,
  passTurn,
  callUno,
  catchUno,
  getPublicState,
  getCurrentPlayerId,
  COLORS,
};
