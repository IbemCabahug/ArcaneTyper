/**
 * Duel.js — Manages 1v1 Mage Duel real-time state via Supabase Realtime.
 *
 * Usage:
 *   const duel = new Duel(supabase, playerName);
 *   await duel.create();               // Host: creates room, returns roomCode
 *   await duel.join(roomCode);         // Guest: joins existing room
 *   duel.broadcast({ score, wpm, barriers, status }); // Send state
 *   duel.onOpponentUpdate = (state) => { ... };
 *   duel.disconnect();
 */
export class Duel {
    constructor(supabase, playerName) {
        this.supabase = supabase;
        this.playerName = playerName || 'Anonymous Mage';
        // Use a UUID as the unique presence key — display names are not guaranteed unique
        this.presenceKey = crypto.randomUUID();
        this.roomCode = null;
        this.channel = null;
        this.isHost = false;
        // Room lock (AT-F9): flipped by markInMatch() when a match starts;
        // join() refuses codes whose presences carry this flag.
        this.inMatch = false;

        // Callbacks
        this.onOpponentUpdate = null;   // (opponentState) => void
        this.onOpponentAttack = null;   // (type) => void
        this.onOpponentJoined = null;   // () => void
        this.onOpponentLeft = null;     // () => void
    }

    /**
     * Generate a short, readable room code.
     */
    _generateCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    /**
     * HOST: Create a new Duel room and start listening for an opponent.
     * @returns {string} The generated Room Code.
     */
    async create() {
        this.isHost = true;
        this.roomCode = this._generateCode();
        await this._subscribe();
        return this.roomCode;
    }

    /**
     * GUEST: Join an existing Duel room by code.
     * @param {string} roomCode
     * @returns {Promise<string|null>} The Host's display name, or null when
     *   the room is locked because a match is already in progress (AT-F9).
     */
    async join(roomCode) {
        this.isHost = false;
        this.roomCode = roomCode.toUpperCase().trim();
        await this._subscribe();

        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };

            // Listen for the first sync event to find the host's display name
            const onSync = () => {
                const state = this.channel.presenceState();
                const otherKeys = Object.keys(state).filter(k => k !== this.presenceKey);
                if (otherKeys.length === 0) return;

                // Room lock (AT-F9): any presence already in a match → refuse,
                // so a leaked room code cannot inject a client mid-round.
                const inProgress = otherKeys.some(k => state[k]?.[0]?.in_match);
                if (inProgress) {
                    finish(null);
                    return;
                }

                // Find opponent by presence key (UUID), get their display name from payload
                const presences = state[otherKeys[0]];
                finish(presences?.[0]?.player_name || 'Unknown Mage');
            };
            this.channel.on('presence', { event: 'sync' }, onSync);

            // Timeout after 1.5 seconds if sync doesn't return host
            setTimeout(() => finish('Unknown Mage'), 1500);
        });
    }

    /**
     * Subscribe to the Supabase Realtime channel for this room.
     */
    async _subscribe() {
        const channelName = `duel:${this.roomCode}`;

        // Clean up any previous channel
        if (this.channel) {
            await this.supabase.removeChannel(this.channel);
        }

        this.channel = this.supabase.channel(channelName, {
            config: { presence: { key: this.presenceKey } }
        });

        // Listen for real-time game state broadcasts
        this.channel.on('broadcast', { event: 'state' }, ({ payload }) => {
            if (payload.player_key !== this.presenceKey && this.onOpponentUpdate) {
                this.onOpponentUpdate(payload);
            }
        });

        // Listen for attacks
        this.channel.on('broadcast', { event: 'attack' }, ({ payload }) => {
            if (payload.player_key !== this.presenceKey && this.onOpponentAttack) {
                this.onOpponentAttack(payload.type);
            }
        });

        // AT-F9 race events (issue/claim/result/state/match_over). Local host
        // actions run directly — ignore echoes of our own payloads.
        this.channel.on('broadcast', { event: 'race' }, ({ payload }) => {
            if (payload.player_key === this.presenceKey) return;
            if (this.onRace) this.onRace(payload);
        });

        // Presence tracking: detect when opponent joins or leaves
        this.channel.on('presence', { event: 'join' }, ({ key }) => {
            if (key !== this.presenceKey && this.onOpponentJoined) {
                this.onOpponentJoined();
            }
        });

        this.channel.on('presence', { event: 'leave' }, ({ key }) => {
            if (key !== this.presenceKey && this.onOpponentLeft) {
                this.onOpponentLeft();
            }
        });

        await this.channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                // Track with UUID key; display name + match-lock flag in payload
                await this.channel.track({
                    player_name: this.playerName,
                    online_at: new Date().toISOString(),
                    in_match: this.inMatch
                });
            }
        });
    }

    /**
     * AT-F9 room lock: flag this presence as mid-match. New join() callers
     * see the flag and refuse the code; re-subscribes preserve it.
     */
    async markInMatch() {
        this.inMatch = true;
        if (this.channel) {
            await this.channel.track({
                player_name: this.playerName,
                online_at: new Date().toISOString(),
                in_match: true
            });
        }
    }

    /**
     * Broadcast the local player's current game state to the opponent.
     * @param {{ score: number, wpm: number, barriers: number, status: string }} payload
     */
    broadcast(payload) {
        if (!this.channel) return;
        this.channel.send({
            type: 'broadcast',
            event: 'state',
            payload: { player_key: this.presenceKey, player_name: this.playerName, ...payload }
        });
    }

    /**
     * Broadcast an interactive sabotage event to the opponent.
     * @param {string} type - e.g. 'blind', 'swarm'
     */
    broadcastAttack(type) {
        if (!this.channel) return;
        this.channel.send({
            type: 'broadcast',
            event: 'attack',
            payload: { player_key: this.presenceKey, type }
        });
    }

    /**
     * AT-F9: send a race event ({ raceType, ... }) to the other player.
     * @param {string} raceType - 'issue' | 'claim' | 'result' | 'state' | 'match_over'
     * @param {object} data
     */
    broadcastRace(raceType, data = {}) {
        if (!this.channel) return;
        this.channel.send({
            type: 'broadcast',
            event: 'race',
            payload: { player_key: this.presenceKey, player_name: this.playerName, raceType, ...data }
        });
    }

    /**
     * Disconnect from the duel channel.
     */
    async disconnect() {
        if (this.channel && this.supabase) {
            await this.supabase.removeChannel(this.channel);
        }
        this.channel = null;
        this.roomCode = null;
    }
}
