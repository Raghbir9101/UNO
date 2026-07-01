# State Persistence Implementation

## Overview

The UNO game server now includes automatic state persistence that saves all active rooms, players, and game states to disk. This ensures that when the server restarts (due to deployment, crash, or maintenance), all ongoing games and player sessions are preserved.

## Features

### 1. Automatic Save Points
- **Periodic Auto-Save**: State is saved every 30 seconds to `data/game-state.json`
- **Event-Based Save**: State is also saved (with 2-second debounce) after critical events:
  - Room creation
  - Player joins
  - Game starts
  - Card plays

### 2. State Recovery on Startup
- On server startup, the last saved state is automatically loaded
- All rooms and game states are restored
- Players are marked as disconnected initially (they can reconnect)
- Old rooms (>24 hours) are automatically cleaned up

### 3. Graceful Shutdown
- When the server receives SIGTERM or SIGINT (Ctrl+C), it:
  - Saves the current state immediately
  - Closes all connections gracefully
  - Exits cleanly

### 4. Backup & Recovery
- Previous state is backed up to `data/game-state.backup.json` before each save
- If the primary state file is corrupted, the backup is automatically loaded

## File Structure

```
data/
├── game-state.json         # Current state
├── game-state.backup.json  # Previous state (backup)
└── game-state.json.tmp     # Temporary file during atomic writes
```

## What Gets Persisted

### Room State
- Room code
- Host ID
- Status (lobby/playing)
- Settings (stacking enabled/disabled)
- Privacy setting (public/private)
- Creation timestamp
- Update sequence number

### Player State
- Player ID
- Nickname
- Connection status (marked as disconnected on load)
- Spectator status
- God mode status (for spectators)

### Game State (if game is in progress)
- All player hands (cards)
- Draw pile
- Discard pile
- Current player turn
- Direction (clockwise/counter-clockwise)
- Active color
- Pending draws (for stacking)
- UNO state tracking
- Winner (if game ended)

## Player Reconnection

When the server restarts:

1. All players are marked as `connected: false`
2. Players can reconnect by:
   - Joining with the same room code
   - Using the same nickname (legacy) OR stored `playerId` (preferred)
3. Their socket is reassigned and they resume exactly where they left off
4. Their hand and game state are immediately sent to them

## Testing Persistence

### Manual Test Steps

1. **Start the server**:
   ```bash
   npm start
   ```
   You should see: `[persistence] No saved state found, starting fresh`

2. **Create a room and start a game**:
   - Open http://localhost:3000/play
   - Create a room
   - Add at least one other player (can use incognito window)
   - Start the game and play a few cards

3. **Verify auto-save**:
   - Wait 30-35 seconds
   - Check the console logs for: `[persistence] Saved state for X room(s)`
   - Verify `data/game-state.json` exists and contains your room

4. **Restart the server** (Ctrl+C, then `npm start`):
   - You should see: `[persistence] Loaded X room(s) from Ym ago`
   - You should see: `[persistence] Restored X room(s) - players can reconnect`

5. **Reconnect as a player**:
   - Refresh the browser
   - Enter the same room code and nickname
   - You should rejoin the game with your cards intact

### Automated Test (Future)

```javascript
// Example test case structure
describe('State Persistence', () => {
  it('should save state every 30 seconds', async () => { ... });
  it('should restore rooms on startup', async () => { ... });
  it('should allow players to reconnect after restart', async () => { ... });
  it('should handle corrupted state files gracefully', async () => { ... });
});
```

## Implementation Details

### Files Modified
1. **`server/statePersistence.js`** (NEW): Core persistence logic
2. **`server/index.js`**: Integration with save/load lifecycle
3. **`.gitignore`**: Added `data/` to prevent committing game states

### Key Functions

#### `statePersistence.saveState(rooms)`
- Converts the `rooms` Map to JSON
- Performs atomic write (write to temp file, then rename)
- Keeps backup of previous state
- Returns `true` on success, `false` on error

#### `statePersistence.loadState()`
- Reads and parses saved state from disk
- Falls back to backup if primary file is corrupted
- Returns `Map` of rooms or `null` if no state found

#### `statePersistence.cleanupOldRooms(rooms, maxAgeMs)`
- Removes rooms older than specified age (default 24 hours)
- Called on startup to prevent stale room buildup

### Memory Considerations

- State file size scales with:
  - Number of active rooms
  - Number of players per room
  - Cards in play (hand size + draw/discard piles)
- Typical overhead: ~5-20KB per active game
- 100 concurrent games ≈ 500KB-2MB state file

## Production Deployment

### Recommended Setup

1. **Ensure data directory exists and has write permissions**:
   ```bash
   mkdir -p data
   chmod 755 data
   ```

2. **Use process manager with graceful shutdown** (PM2, systemd, etc.):
   ```bash
   # PM2 example
   pm2 start server/index.js --name uno-server
   pm2 reload uno-server  # Graceful reload preserves state
   ```

3. **Optional: Backup state files periodically**:
   ```bash
   # Cron job to backup state
   0 * * * * cp /path/to/data/game-state.json /backups/game-state-$(date +\%Y\%m\%d-\%H).json
   ```

### Monitoring

Check logs for these messages:
- ✅ `[persistence] Saved state for X room(s)` — Auto-save working
- ✅ `[persistence] Loaded X room(s) from Ym ago` — State restored on startup
- ⚠️ `[persistence] Failed to save state: <error>` — Write permission or disk space issue
- ⚠️ `[persistence] Failed to load state: <error>` — Corrupted state file (will try backup)

## Future Enhancements

- [ ] Compress state files (gzip) for large room counts
- [ ] Add Redis/database backend option for multi-server setups
- [ ] Implement incremental saves (only changed rooms)
- [ ] Add state versioning/migration for schema changes
- [ ] Implement state replication across servers
