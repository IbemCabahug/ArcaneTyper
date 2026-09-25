/**
 * DuelRace.js — AT-F9 shared-arena word race controller.
 *
 * One word at a time, issued by the HOST; the quickest CORRECT typist wins
 * the race and deals word-length damage to the opponent's 100 HP instantly.
 * Match ends: KO (0 HP) | clock (120 s; equal HP → OVERTIME sudden death)
 * | disconnect grace (5 s) | forfeit. Words never damage. A mistake forfeits
 * the word to your opponent (both mistake → word expires, no damage).
 *
 * AT-F9 P3 — "the word is gone the moment it is decided":
 *   A successful claim broadcasts `taken` immediately, so the SAME word
 *   dissolves on the opponent's screen the instant it is stolen instead of
 *   falling on until the floor (owner-reported: a word already typed by the
 *   other player kept falling and could even shatter on the loser's mage).
 *   The host then arbitrates within CLAIM_WINDOW_MS of the first claim so a
 *   decided word can never park the lane while it waits for a claim that the
 *   dissolve already made impossible.
 *
 * Fairness: durations are measured from each client's OWN word-appearance
 * (latency cancels out); the host arbitrates after both claims, or the first
 * claim + CLAIM_WINDOW_MS, or local expiry + grace; |Δ| < 75 ms = dead heat
 * → nobody scores.
 * AT-F10 — class actives in the arena. `Tab`/`Enter` (and the mobile button,
 * which routes through the same CombatSystem call) cast the caster's Discipline
 * active, priced in the mana the HUD already shows every match. Every effect is
 * SELF-SIDE and applied by the HOST: the caster arms one buff locally and
 * announces it with a `cast` frame, and only `_resolve()` spends it, on the frame
 * both clients mirror. That is why no active may clear/spawn a word or reach
 * across the lane — the shared race word and the single damage path stay exactly
 * as AT-F9 left them.
 */
import { FloatingText } from '../FloatingText.js';
import { otherSlot, teamColorFor } from './ArenaTeams.js';
import { activeForClass, mageActiveById, normalizeMageClassForCharacter } from '../../backend/MageClasses.js';

const START_HP = 100;
const MATCH_SECONDS = 120;
const DMG_PER_CHAR = 1;              // damage = word length × scalar (AT-F9)
const CLAIM_GRACE_MS = 900;          // in-flight claim wait after local expiry
const CLAIM_WINDOW_MS = 600;         // P3: arbitration window after the 1st claim
const RESULT_PAUSE_MS = 700;         // banner beat between words
const DEAD_HEAT_MS = 75;             // nobody scores inside this window
const DISCONNECT_GRACE_MS = 5000;    // presence-leave grace (owner decision)
const ISSUE_WATCHDOG_MS = 15000;     // host safety: word must resolve by then
// AT-F10: size/height of the cast + armed-skill callouts. The skill line rides
// ABOVE the damage line it explains (see _floatAtSlot's `lift`) so a boosted
// strike never stacks two labels on the same pixel.
const BUFF_FLOAT_SIZE = 22;
const BUFF_FLOAT_LIFT = 34;
const ACTIVE_WINDOW_MS = 3000;
const BLOOD_PACT_MAX_HEAL = 15;
const BLOOD_PACT_STREAK_CAP = 100;
const BLOOD_PACT_STREAK_DIVISOR = 20;

export class DuelRace {
    constructor({ game, duel, isHost, opponentName, onMatchEnd }) {
        this.game = game;
        this.duel = duel;
        this.isHost = isHost;
        this.onMatchEnd = onMatchEnd;
        // Fixed team slots: A = host (blue, left), B = guest (red, right).
        this.mine = isHost ? 'A' : 'B';
        this.theirs = otherSlot(this.mine);
        this.names = {
            A: isHost ? duel.playerName : opponentName,
            B: isHost ? opponentName : duel.playerName
        };

        this.hp = { A: START_HP, B: START_HP };
        this.wins = { A: 0, B: 0 };
        this.timeLeft = MATCH_SECONDS;
        this.overtime = false;
        this.over = false;

        this.idx = 0;
        this.phase = 'idle';          // idle | word | result
        this.currentText = '';
        this.appearAt = 0;
        this.myResolved = false;
        this.myForfeited = false;
        this.myClaim = null;
        // P3: the word was decided against us (opponent's `taken` arrived) —
        // our own claims/forfeits on it are then pointless, and its sprite is
        // already dissolving, so input hooks must ignore it.
        this.myDecided = false;
        this.oppResolved = false;
        this.oppClaim = null;

        // AT-F10: one armed class active per slot. The map is the single source
        // of truth on BOTH clients — the host decides what is spent (`_resolve`)
        // and `result` / `state` carry the surviving map, so an indicator can
        // never stay lit after the host spent it.
        this.buffs = { A: null, B: null };
        // Slot → Discipline id (ours from stats, theirs from presence). Labels
        // only: arbitration reads `buffs`, never this.
        this.classes = { A: null, B: null };
        this.characters = { A: null, B: null };
        // The cast surfaces' pre-duel wording, saved so stop() can put it back.
        this._novaLabel = null;
        this._hintHTML = null;

        this._graceTimer = null;
        this._windowTimer = null;
        this._pauseTimer = null;
        this._watchdog = null;
        this._leaveTimer = null;
        this._leaveFloatTimer = null;
        this._clockTimer = null;
        this._stateTimer = null;
        this._deferredIssueTimer = null;
        this._timeStopTimer = null;
        this._frozenMs = 0;
        this._freezeStartedAt = null;
        // Host-authoritative Time Stop deadline. The wall-clock deadline is
        // carried in race frames so a late guest starts from the same instant.
        this.timeStopUntil = 0;
        this.timeStopSlot = null;
        this.buffUntil = { A: 0, B: 0 };
        this._buffTimers = { A: null, B: null };
        this.debuffs = { A: null, B: null };
    }

    $(id) { return document.getElementById(id); }

    start() {
        this.$('duel-scorebar')?.classList.remove('hidden');
        this._renderNames();
        this._render();

        // AT-F9 Phase 2: side + opponent identity for the shared canvas
        this.game.duelSide = this.mine; // 'A' host | 'B' guest
        const st = this.duel.channel?.presenceState() || {};
        const oppKey = Object.keys(st).find(k => k !== this.duel.presenceKey);
        const oppPresence = oppKey ? st[oppKey]?.[0] : null;
        // AT-L6: the name handed to the constructor may be join()'s placeholder
        // (presence sync can outrun the 1.5 s timeout). Presence is the
        // authority when it is already here; otherwise the FIRST opponent frame
        // heals it in _onRace. The placeholder is never special-cased — the wire
        // and presence decide the name, not the fallback.
        if (oppPresence?.player_name) this.names[this.theirs] = oppPresence.player_name;
        this._renderNames();       // repaint — may have just learned the real name
        this.game.duelOpponent = {
            name: this.names[this.theirs],
            character: oppPresence?.character || 'wizard',
            wand: oppPresence?.wand || null
        };
        // AT-F10: both Disciplines — ours from stats, theirs from the presence the
        // duel already tracks — then label the cast surfaces and repaint the
        // chips (the first _render above predates both).
        this.timeStopUntil = 0;
        this.timeStopSlot = null;
        this._frozenMs = 0;
        this._freezeStartedAt = null;
        this.duelCombos = { A: 0, B: 0 };
        this._lastComboSentAt = 0;
        this.game.duelCombos = this.duelCombos;
        this._pendingTimeStop = null;
        this.game.duelAuras = { A: null, B: null };
        this.game.duelBuffUntil = { A: 0, B: 0 };
        this.game.duelDebuffs = { A: null, B: null };
        this.buffUntil = { A: 0, B: 0 };
        this.debuffs = { A: null, B: null };
        this.classes[this.mine] = this.game.stats?.mageClass || null;
        this.classes[this.theirs] = oppPresence?.mage_class
            ? normalizeMageClassForCharacter(oppPresence.mage_class, oppPresence.character || 'wizard')
            : null;
        // Which CHARACTER each slot plays. The Novice Discipline is shared by
        // all three characters, so the class id alone cannot say whether a
        // Novice sigil is the Celestial, Void or Blood variant — the renderer
        // needs the skin id directly. Keyed to the fixed team slots so both
        // clients read the same character for the same slot.
        this.characters[this.mine] = this.game.stats?.selectedCharacter || 'wizard';
        this.characters[this.theirs] = oppPresence?.character || 'wizard';
        this.game.duelCharacters = this.characters;
        this._labelCastSurfaces();
        this._render();

        // Game hooks (Phase 0 'duel' gates invoke these only in duel mode)
        this.game.onRaceWordExpired = () => this._onLocalExpiry();
        this.game.onRaceTyped = () => this._onTyped();
        this.game.onRaceMistake = () => this._onMistake();
        this.game.onDuelCombo = (combo) => this._onCombo(combo);
        this.game.onDuelCast = () => this.cast(); // AT-F10: Tab/Enter in the arena

        // Transport + presence — overrides the pre-match handlers
        this.duel.onRace = (p) => this._onRace(p);
        this.duel.onOpponentLeft = () => this._onOpponentLeft();
        this.duel.onOpponentJoined = () => this._onOpponentRejoined();

        if (this.isHost) {
            this._clockTimer = setInterval(() => this._tickClock(), 1000);
            this._stateTimer = setInterval(() => this._sendState(), 1000);
            this._issueNext();
        }
    }

    stop() {
        this.over = true;
        clearTimeout(this._graceTimer);
        this._clearWindow();
        clearTimeout(this._pauseTimer);
        clearTimeout(this._watchdog);
        clearTimeout(this._leaveTimer);
        clearTimeout(this._leaveFloatTimer);
        clearTimeout(this._deferredIssueTimer);
        clearInterval(this._clockTimer);
        clearInterval(this._stateTimer);
        this.game.onRaceWordExpired = null;
        this.game.onRaceTyped = null;
        this.game.onRaceMistake = null;
        this.game.onDuelCombo = null;
        this.game.onDuelCast = null;   // AT-F10: Tab is the ultimate again
        clearTimeout(this._timeStopTimer);
        this._timeStopTimer = null;
        // AT-F10: disarm both slots, blank both chips and hand the input
        // surfaces back to their own wording — a duel must leave no trace in the
        // Survival HUD (the same contract the score bar follows).
        this.buffs = { A: null, B: null };
        this.classes = { A: null, B: null };
        this.characters = { A: null, B: null };
        this.timeStopUntil = 0;
        this.timeStopSlot = null;
        this.duelCombos = { A: 0, B: 0 };
        this._lastComboSentAt = 0;
        this.game.duelCombos = this.duelCombos;
        this.game.duelAuras = { A: null, B: null };
        this.game.duelBuffUntil = { A: 0, B: 0 };
        this.game.duelDebuffs = { A: null, B: null };
        this.game.duelTimeStopUntil = 0;
        this.game.duelTimeStopSlot = null;
        this._restoreCastSurfaces();
        this._renderBuff('a', 'A');
        this._renderBuff('b', 'B');
        this.duel.onRace = null;
        this.$('duel-scorebar')?.classList.add('hidden');
        this.$('sb-flag')?.classList.add('hidden');
    }

    /** endDuel calls this BEFORE stop() when the LOCAL player quits. */
    announceForfeit() {
        if (this.over) return null;
        this.over = true;
        return this.duel.broadcastRace('match_over', this._snapshot({ winner: this.theirs, reason: 'forfeit' }));
    }

    summary() {
        return { mine: this.wins[this.mine], theirs: this.wins[this.theirs] };
    }

    _snapshot(extra) {
        return {
            ...extra,
            // AT-F10: the armed actives ride every heartbeat as well as every
            // result, so a chip that missed/lost a `cast` frame converges within
            // a second instead of staying wrong for the whole match.
            buffUntil: { A: this.buffUntil.A, B: this.buffUntil.B },
            debuffs: { A: this.debuffs.A, B: this.debuffs.B },
            armed: { A: this.buffs.A, B: this.buffs.B },
            auras: { A: this.game.duelAuras.A, B: this.game.duelAuras.B },
            timeStopUntil: this.timeStopUntil,
            timeStopSlot: this.timeStopSlot,
            combos: { A: this.duelCombos.A, B: this.duelCombos.B },
            hpA: this.hp.A, hpB: this.hp.B,
            winsA: this.wins.A, winsB: this.wins.B,
            timeLeft: this.timeLeft, overtime: this.overtime
        };
    }

    // ── host: clock & heartbeat ──────────────────────────────────────────
    _tickClock() {
        if (this.over || this.overtime || Date.now() < this.timeStopUntil) return;
        this.timeLeft = Math.max(0, this.timeLeft - 1);
        if (this.timeLeft === 0) {
            if (this.hp.A === this.hp.B) {
                this.overtime = true;
                this._float('SUDDEN DEATH!', '#ffd700', 44);
            } else {
                this._endMatch(this.hp.A > this.hp.B ? 'A' : 'B', 'time');
                return;
            }
        }
        this._render();
    }

    _sendState() {
        if (this.over) return;
        this.duel.broadcastRace('state', this._snapshot({}));
    }

    // ── host: word loop ──────────────────────────────────────────────────
    _issueNext() {
        if (this.over || this.phase === 'word') return;
        if (Date.now() < this.timeStopUntil) {
            clearTimeout(this._deferredIssueTimer);
            this._deferredIssueTimer = setTimeout(() => this._issueNext(), this.timeStopUntil - Date.now() + 25);
            return;
        }
        this.idx++;
        const text = this.game.dictionary.getWordForDifficulty('normal');
        const x = 100 + Math.random() * Math.max(this.game.canvas.width - 200, 1);
        const baseSpeed = 0.8 + Math.random() * 0.6;
        this._spawnLocal(text, x, baseSpeed);
        this.duel.broadcastRace('issue', { idx: this.idx, text, x, baseSpeed });
        clearTimeout(this._watchdog);
        this._watchdog = setTimeout(() => {
            if (this.phase === 'word') this._onLocalExpiry();
        }, ISSUE_WATCHDOG_MS);
    }

    _spawnLocal(text, x, baseSpeed) {
        this.game.spawnRaceWord(text, { x, baseSpeed });
        this.appearAt = performance.now();
        this.currentText = text;
        this.phase = 'word';
        this.myResolved = false;
        this.myForfeited = false;
        this.myClaim = null;
        this.myDecided = false;
        this._clearWindow();
        this.oppResolved = false;
        this.oppClaim = null;
    }

    // ── P3: bounded arbitration after the first claim ────────────────────
    // A decided word must not park the lane: once ANY claim is in, the host
    // gives an in-flight reply CLAIM_WINDOW_MS to land (that is the fairness
    // window that keeps latency from deciding near-ties), then resolves with
    // whatever claims it has.
    _armWindow() {
        if (this.over || this.phase !== 'word' || !this.isHost || this._windowTimer) return;
        this._windowTimer = setTimeout(() => {
            this._windowTimer = null;
            if (this.over || this.phase !== 'word') return;
            if (Date.now() < this.timeStopUntil) {
                this._windowTimer = setTimeout(() => {
                    this._windowTimer = null;
                    this._armWindow();
                }, this.timeStopUntil - Date.now() + CLAIM_WINDOW_MS);
                return;
            }
            this.myResolved = true;
            this.oppResolved = true;
            this._resolve();
        }, CLAIM_WINDOW_MS);
    }

    _clearWindow() {
        clearTimeout(this._windowTimer);
        this._windowTimer = null;
    }

    _maybeResolve() {
        if (this.over || this.phase !== 'word') return;
        if (this.myResolved && this.oppResolved) this._resolve();
    }

    // Host's race word hit the floor (or watchdog fired) — give in-flight
    // claims one grace beat, then resolve with whatever has arrived.
    _onLocalExpiry() {
        if (this.over || this.phase !== 'word' || !this.isHost) return;
        if (this.myResolved && this.oppResolved) return;
        clearTimeout(this._graceTimer);
        if (this.phase === 'word' && Date.now() < this.timeStopUntil) {
            this._watchdog = setTimeout(() => this._onLocalExpiry(), this.timeStopUntil - Date.now() + 25);
            return;
        }
        this._graceTimer = setTimeout(() => {
            if (this.over || this.phase !== 'word') return;
            if (Date.now() < this.timeStopUntil) {
                this._graceTimer = setTimeout(() => this._onLocalExpiry(), this.timeStopUntil - Date.now() + CLAIM_GRACE_MS);
                return;
            }
            this.myResolved = true;
            this.oppResolved = true;
            this._resolve();
        }, CLAIM_GRACE_MS);
    }

    _resolve() {
        clearTimeout(this._graceTimer);
        clearTimeout(this._watchdog);
        this._clearWindow();
        this.phase = 'result';

        const mineDur = (!this.myForfeited && this.myClaim != null) ? this.myClaim : null;
        const oppDur = (this.oppClaim != null) ? this.oppClaim : null;
        let winner = null;
        if (mineDur != null && oppDur != null) {
            if (Math.abs(mineDur - oppDur) >= DEAD_HEAT_MS) {
                winner = mineDur < oppDur ? this.mine : this.theirs;
            }
        } else if (mineDur != null) winner = this.mine;
        else if (oppDur != null) winner = this.theirs;

        for (const slot of ['A', 'B']) {
            if (this.debuffs?.[slot]?.until && this.debuffs[slot].until < Date.now()) {
                this.debuffs[slot] = null;
                this.game.duelDebuffs[slot] = null;
            }
        }
        const loser = winner ? (winner === 'A' ? 'B' : 'A') : null;

        // AT-F10: the winner is decided FIRST, and only then may an active edit
        // the outcome. Nothing here reads or writes a measured duration; the
        // arbiter's own input stays untouched.
        const dmgRaw = winner ? this.currentText.length * DMG_PER_CHAR : 0;
        let dmg = dmgRaw;
        let amp = null;    // the winning skill that shaped this strike
        let ward = null;   // the losing skill that absorbed it
        let heal = 0;      // Blood Pact healing, resolved by the host
        let healSlot = null;
        const winnerBuff = winner ? mageActiveById(this.buffs[winner]) : null;
        const loserBuff = winner ? mageActiveById(this.buffs[loser]) : null;
        if (winnerBuff && (winnerBuff.kind === 'damage' || winnerBuff.kind === 'combo_damage')) {
            dmg = Math.round(dmg * winnerBuff.value);
            if (winnerBuff.kind === 'combo_damage') {
                dmg += Math.min(4, Math.floor(this.duelCombos[winner] / 20));
            }
            amp = winnerBuff.id;
        }
        if (loserBuff && loserBuff.kind === 'mitigation') {
            dmg = Math.round(dmg * loserBuff.value);
            ward = loserBuff.id;
        }
        if (winner && this.debuffs[winner]) {
            const debuff = this.debuffs[winner];
            if (debuff.until >= Date.now()) {
                dmg = Math.round(dmg * debuff.value);
                ward = debuff.id;
            }
            this.debuffs[winner] = null;
            this.game.duelDebuffs[winner] = null;
        }
        if (winnerBuff && winnerBuff.kind === 'execution') {
            const missing = Math.max(0, START_HP - this.hp[loser]);
            // Apply execution on top of any already-resolved mitigation rather
            // than replacing it; a Reaper can finish a low-HP mage, but a ward
            // still has to matter when one is armed.
            dmg = Math.round(dmg * winnerBuff.value) + Math.min(4, Math.floor(missing / 20));
            amp = winnerBuff.id;
        }
        if (winnerBuff && winnerBuff.kind === 'self_sacrifice') {
            const missing = Math.max(0, START_HP - this.hp[winner]);
            dmg += Math.min(8, 4 + Math.floor(missing / 10));
            amp = winnerBuff.id;
        }
        if (winnerBuff && winnerBuff.kind === 'lifesteal') {
            const streak = Math.max(0, Math.min(BLOOD_PACT_STREAK_CAP, this.duelCombos[winner] || 0));
            const streakBonus = Math.floor(streak / BLOOD_PACT_STREAK_DIVISOR);
            heal = Math.min(BLOOD_PACT_MAX_HEAL, Math.max(0, Math.round(dmg * winnerBuff.value) + streakBonus));
            healSlot = winner;
        }
        // Active effects are resolved only after the word winner is known.
        // The frame tells both clients which strike/ward actually shaped it.

        // Spent = the buff actually did something. A dead heat or a double
        // forfeit has no winner, so nothing is spent and both mages stay armed:
        // a rule both clients derive from THIS frame, never from local timing.
        // A ward is only spent when it had damage to absorb; a Cryomancer who
        // WINS the word keeps it for the next loss.
        if (winner) {
            if (winnerBuff && winnerBuff.kind !== 'mitigation') {
                this._clearActive(winner);
            }
            if (loserBuff && (loserBuff.kind === 'mitigation' || loserBuff.kind === 'self_sacrifice')) {
                this._clearActive(loser);
            }
            if (winnerBuff && winnerBuff.kind === 'opponent_weaken') {
                this.debuffs[loser] = {
                    id: winnerBuff.id,
                    value: winnerBuff.value,
                    until: Date.now() + ACTIVE_WINDOW_MS
                };
                this.game.duelDebuffs[loser] = this.debuffs[loser];
            }
        }

        if (winner) {
            this.hp[loser] = Math.max(0, this.hp[loser] - dmg);
            if (heal > 0 && healSlot) {
                const before = this.hp[healSlot];
                this.hp[healSlot] = Math.min(START_HP, this.hp[healSlot] + heal);
                heal = this.hp[healSlot] - before;
            }
            this.wins[winner]++;
            // A lost race breaks the loser's endless combo exactly like a
            // mistake breaks the normal typing streak. The host resets the
            // shared slot before the result frame is broadcast.
            this.duelCombos[loser] = 0;
            if (loser === this.mine && this.game.stats) {
                this.game.stats.combo = 0;
                this.game.stats.updateHUD?.();
            }
        }

        let matchOver = false;
        let matchWinner = null;
        let reason = null;
        if (winner && this.hp[loser] <= 0) {
            matchOver = true; matchWinner = winner; reason = 'ko';
        } else if (winner && this.overtime) {
            matchOver = true; matchWinner = winner; reason = 'overtime';
        }

        const r = {
            idx: this.idx, winner, dmg, dmgRaw, amp, ward,
            heal, healSlot,
            armed: { A: this.buffs.A, B: this.buffs.B },
            buffUntil: { A: this.buffUntil.A, B: this.buffUntil.B },
            debuffs: { A: this.debuffs.A, B: this.debuffs.B },
            auras: { A: this.game.duelAuras.A, B: this.game.duelAuras.B },
            timeStopUntil: this.timeStopUntil,
            timeStopSlot: this.timeStopSlot,
            combos: { A: this.duelCombos.A, B: this.duelCombos.B },
            hpA: this.hp.A, hpB: this.hp.B,
            winsA: this.wins.A, winsB: this.wins.B,
            timeLeft: this.timeLeft, overtime: this.overtime,
            matchOver, matchWinner, reason
        };
        this._applyResult(r);
        this.duel.broadcastRace('result', r);

        clearTimeout(this._pauseTimer);
        if (matchOver) {
            this.over = true;
            this._pauseTimer = setTimeout(() => this._finishBy(matchWinner, reason), RESULT_PAUSE_MS + 300);
        } else {
            this._pauseTimer = setTimeout(() => this._issueNext(), RESULT_PAUSE_MS);
        }
    }

    // Shared by host (local resolve) and guest (mirror of host's result).
    _applyResult(r) {
        this.hp.A = r.hpA; this.hp.B = r.hpB;
        this.wins.A = r.winsA; this.wins.B = r.winsB;
        this.timeLeft = r.timeLeft;
        this.overtime = !!r.overtime;
        this._adoptBuffs(r);
        this._adoptAuras(r);
        this._adoptDebuffs(r);
        this._adoptCombos(r);
        this._adoptTimeStop(r);
        if (r.winner === this.theirs && this.game.stats) {
            this.game.stats.combo = 0;
            this.game.stats.updateHUD?.();
        }
        this._render();

        if (r.winner === this.mine) {
            // We struck — the damage landed on THEIR mage, so the number
            // belongs over their side of the lane, not over the centre.
            this._floatAtSlot(this.theirs, `OPPONENT −${r.dmg} HP`, '#ffd700', 30);
            if (r.amp) {
                // The skill line rides above the damage line it explains.
                const skill = mageActiveById(r.amp);
                if (skill) this._floatAtSlot(this.theirs, `${skill.title.toUpperCase()}!`, '#ff9800', BUFF_FLOAT_SIZE, BUFF_FLOAT_LIFT);
            }
        } else if (r.winner === this.theirs) {
            // Their strike landed on OUR mage.
            this._floatAtSlot(this.mine, 'OPPONENT STRIKES!', '#ff4b4b', 30);
            if (r.ward) {
                // A ward that isn't announced is invisible damage maths.
                this._floatAtSlot(this.mine, `WARDED −${Math.max(0, r.dmgRaw - r.dmg)}`, '#4dd0e1', BUFF_FLOAT_SIZE, BUFF_FLOAT_LIFT);
            }
        } else {
            this._float('WORD LOST', '#b892b0', 30);
        }
        if (r.heal > 0 && r.healSlot) {
            this._floatAtSlot(r.healSlot, `BLOOD PACT +${r.heal} HP`, '#ff6b7a', BUFF_FLOAT_SIZE, BUFF_FLOAT_LIFT);
        }
        if (r.winner) this._shake(r.winner === 'A' ? 'b' : 'a');
    }

    _endMatch(winner, reason) {
        if (this.over) return;
        this.over = true;
        this._clearWindow();
        clearTimeout(this._graceTimer);
        clearTimeout(this._pauseTimer);
        clearTimeout(this._watchdog);
        clearTimeout(this._leaveTimer);
        clearInterval(this._clockTimer);
        clearInterval(this._stateTimer);
        this.duel.broadcastRace('match_over', this._snapshot({ winner, reason }));
        this._pauseTimer = setTimeout(() => this._finishBy(winner, reason), 500);
    }

    _finishBy(winner, reason) {
        if (this.onMatchEnd) this.onMatchEnd(winner === this.mine, reason);
    }

    // ── input hooks ──────────────────────────────────────────────────────
    _onTyped() {
        if (this.over || this.phase !== 'word' || this.myResolved || this.myDecided) return;
        this.myResolved = true;
        if (this.myForfeited) return;
        const dur = Math.max(1, Math.round(performance.now() - this.appearAt));
        // AT-F9 P3: the word is claimed → tell the opponent to dissolve it NOW.
        // Sent before the claim itself so the loser stops typing at once; a
        // claim already in flight still counts inside the host's window.
        this.duel.broadcastRace('taken', { idx: this.idx });
        if (this.isHost) {
            this.myClaim = dur;
            this._armWindow();
            this._maybeResolve();
        } else {
            this.duel.broadcastRace('claim', { idx: this.idx, dur });
        }
    }

    _onCombo(combo) {
        if (this.over || this.phase !== 'word') return;
        const value = Math.max(0, Math.min(9999, Math.floor(Number(combo) || 0)));
        this.duelCombos[this.mine] = value;
        this.game.duelCombos = this.duelCombos;
        // The other client only needs the visual aura to be responsive. A
        // bounded progress frame keeps the effect live without turning every
        // keystroke into an unbounded realtime broadcast; state/results heal a
        // missed or throttled frame within the existing 1 Hz contract.
        const now = Date.now();
        if (now - this._lastComboSentAt >= 100) {
            this._lastComboSentAt = now;
            this.duel.broadcastRace('combo', { idx: this.idx, combo: value });
        }
    }

    _onComboFrame(p) {
        if (!p || (p.player_key && p.player_key === this.duel.presenceKey)) return;
        if (p.idx !== this.idx || this.phase !== 'word') return;
        const value = Math.max(0, Math.min(9999, Math.floor(Number(p.combo) || 0)));
        this.duelCombos[this.theirs] = value;
        this.game.duelCombos = this.duelCombos;
    }

    _onMistake() {
        if (this.over || this.phase !== 'word' || this.myResolved || this.myDecided) return;
        // AT-F9: one mistake forfeits the current word to your opponent.
        // NOTE: no `taken` broadcast here — the word is still live for them to
        // win, so it must keep falling on their screen.
        this.myResolved = true;
        this.myForfeited = true;
        this._floatAtSlot(this.mine, 'WORD FORFEITED!', '#ff4b4b', 26);
        if (this.isHost) {
            this._maybeResolve();
        } else {
            this.duel.broadcastRace('claim', { idx: this.idx, forfeited: true });
        }
    }

    // ── AT-F10: class actives ────────────────────────────────────────────
    /**
     * Cast this player's Discipline active. `Tab`/`Enter` — and the mobile
     * button, which routes through the same CombatSystem call — arrive here via
     * `game.onDuelCast`.
     *
     * Returns TRUE for every press the arena owned, INCLUDING the ones it has to
     * refuse, because a false return falls through to "THE ARENA SEALS YOUR
     * ULTIMATE!" — which stopped being the whole truth the moment classes had
     * actives. FALSE stays reserved for "this press has nothing to do here".
     */
    cast() {
        if (this.over || !this.game.stats) return false;
        const skill = activeForClass(this.game.stats.mageClass);
        if (!skill) return false;                     // roster says: no active
        if (this.buffs[this.mine]) {
            this._floatAtSlot(this.mine, 'SKILL ALREADY ARMED', '#ff9800', BUFF_FLOAT_SIZE, BUFF_FLOAT_LIFT);
            this.game.audio?.playErrorSound?.();
            return true;
        }
        if (skill.kind === 'time_stop' && (this.phase !== 'word' || this.timeStopUntil > Date.now() || this._pendingTimeStop === this.mine)) {
            const message = this.phase !== 'word' ? 'NO ACTIVE WORD' : 'TIME ALREADY STOPPED';
            this._floatAtSlot(this.mine, message, '#c084fc', BUFF_FLOAT_SIZE, BUFF_FLOAT_LIFT);
            this.game.audio?.playErrorSound?.();
            return true;
        }
        if (skill.kind === 'self_sacrifice' && this.hp[this.mine] <= skill.value) {
            this._floatAtSlot(this.mine, 'NOT ENOUGH BLOOD', '#ff4b4b', BUFF_FLOAT_SIZE, BUFF_FLOAT_LIFT);
            this.game.audio?.playErrorSound?.();
            return true;
        }
        if (!this.game.stats.useMana(skill.cost)) {
            this._floatAtSlot(this.mine, 'NOT ENOUGH MANA', '#ff9800', BUFF_FLOAT_SIZE, BUFF_FLOAT_LIFT);
            this.game.audio?.playErrorSound?.();
            return true;
        }
        if (skill.kind === 'time_stop') {
            this._pendingTimeStop = this.mine;
            this.game.audio?.playMagicSpark?.();
            this._floatAtSlot(this.mine, `${skill.title.toUpperCase()}!`, '#c084fc', BUFF_FLOAT_SIZE);
            this.duel.broadcastRace('cast', { idx: this.idx, skill: skill.id });
            if (this.isHost) this._activateTimeStop(this.mine, skill.value, true);
            this._render();
            return true;
        }
        // HP and the Bloodletting self-cost are host-authoritative. The host
        // applies its own accepted cost here; a guest never mutates HP locally
        // and receives the host's authoritative snapshot instead.
        if (skill.kind === 'self_sacrifice' && this.isHost) {
            this.hp[this.mine] = Math.max(1, this.hp[this.mine] - skill.value);
        }
        this._armActive(this.mine, skill);
        this.game.audio?.playMagicSpark?.();
        this._floatAtSlot(this.mine, `${skill.title.toUpperCase()} ARMED!`, teamColorFor(this.mine), BUFF_FLOAT_SIZE);
        // One frame, host-authoritative. A buff has to survive a word we never
        // claimed (Glacial Ward absorbs a LOSS), which a `claim` payload cannot
        // carry — and announcing it is also what makes it readable to the other
        // mage before it lands.
        this.duel.broadcastRace('cast', { idx: this.idx, skill: skill.id });
        if (skill.kind === 'self_sacrifice' && this.isHost) this._sendState();
        this._render();
        return true;
    }

    _armActive(slot, skill, duration = ACTIVE_WINDOW_MS) {
        const until = Date.now() + duration;
        this.buffs[slot] = skill.id;
        this.buffUntil[slot] = until;
        this.game.duelAuras[slot] = skill.id;
        this.game.duelBuffUntil[slot] = until;
        clearTimeout(this._buffTimers[slot]);
        this._buffTimers[slot] = setTimeout(() => {
            if (this.buffUntil[slot] !== until || !this.buffs[slot]) return;
            this.buffs[slot] = null;
            this.buffUntil[slot] = 0;
            this.debuffs[slot] = null;
            this.game.duelBuffUntil[slot] = 0;
            this.game.duelAuras[slot] = null;
            this.game.duelDebuffs[slot] = null;
            this._floatAtSlot(slot, 'ACTIVE FADED', '#b892b0', 18, BUFF_FLOAT_LIFT);
            this._render();
        }, duration + 25);
        return until;
    }

    _clearActive(slot) {
        clearTimeout(this._buffTimers[slot]);
        this._buffTimers[slot] = null;
        this.buffs[slot] = null;
        this.buffUntil[slot] = 0;
        this.game.duelAuras[slot] = null;
        this.game.duelBuffUntil[slot] = 0;
    }

    /**
     * Host side: the challenger armed a skill. The id is resolved against the
     * roster, so a client cannot invent an effect, and re-arming while armed is
     * refused here exactly as `cast()` refuses it locally — one buff per player,
     * and only the host's map is authoritative.
     */
    _activateTimeStop(slot, duration = 3000, broadcast = false) {
        if (this.over || Date.now() < this.timeStopUntil) return false;
        const until = Date.now() + Math.max(0, duration);
        this.timeStopUntil = until;
        this.timeStopSlot = slot;
        this.game.duelTimeStopUntil = until;
        this.game.duelTimeStopSlot = slot;
        this.game.duelAuras[slot] = 'time-stop';
        this._pendingTimeStop = null;
        if (broadcast) {
            this.duel.broadcastRace('time_stop', { until, slot, skill: 'time-stop' });
        }
        clearTimeout(this._timeStopTimer);
        this._timeStopTimer = setTimeout(() => {
            if (this.timeStopUntil !== until) return;
            this.timeStopUntil = 0;
            this.timeStopSlot = null;
            this.game.duelTimeStopUntil = 0;
            this.game.duelTimeStopSlot = null;
            this.game.duelAuras[slot] = null;
            this._render();
        }, Math.max(0, until - Date.now()) + 25);
        return true;
    }

    _onTimeStop(p) {
        if (this.isHost || this.over || !p || p.skill !== 'time-stop') return;
        const until = Number(p.until);
        if (!Number.isFinite(until) || until <= Date.now()) return;
        const slot = p.slot === 'A' || p.slot === 'B' ? p.slot : this.theirs;
        this.timeStopUntil = until;
        this.timeStopSlot = slot;
        this.game.duelTimeStopUntil = until;
        this.game.duelTimeStopSlot = this.timeStopSlot;
        this.game.duelAuras[this.timeStopSlot] = 'time-stop';
        this._pendingTimeStop = null;
        this._floatAtSlot(this.timeStopSlot, 'TIME STOP!', '#c084fc', BUFF_FLOAT_SIZE);
        clearTimeout(this._timeStopTimer);
        this._timeStopTimer = setTimeout(() => {
            if (this.timeStopUntil !== until) return;
            this.timeStopUntil = 0;
            this.timeStopSlot = null;
            this.game.duelTimeStopUntil = 0;
            this.game.duelTimeStopSlot = null;
            this.game.duelAuras[slot] = null;
            this._render();
        }, Math.max(0, until - Date.now()) + 25);
    }

    _onCast(p) {
        if (!this.isHost || this.over) return;
        if (p.player_key && p.player_key === this.duel.presenceKey) return; // never self-echo
        const skill = mageActiveById(p.skill);
        if (!skill) return;
        if (skill.kind === 'time_stop') {
            if (this.phase !== 'word' || Date.now() < this.timeStopUntil || !this._activateTimeStop(this.theirs, skill.value, true)) return;
            this._render();
            return;
        }
        if (this.buffs[this.theirs]) return;
        if (skill.kind === 'self_sacrifice') {
            if (this.hp[this.theirs] <= skill.value) return;
            this.hp[this.theirs] = Math.max(1, this.hp[this.theirs] - skill.value);
        }
        this._armActive(this.theirs, skill);
        this._floatAtSlot(this.theirs, `${skill.title.toUpperCase()} ARMED!`, teamColorFor(this.theirs), BUFF_FLOAT_SIZE);
        if (skill.kind === 'self_sacrifice') this._sendState();
        this._render();
    }

    /**
     * The arena casts through Survival's own surfaces, so they are re-labelled
     * for the match: `Tab`/`Enter` (the `#mana-hint` line) and the mobile button.
     * No second input surface, and no letter-key conflict with typing.
     */
    _labelCastSurfaces() {
        const skill = activeForClass(this.game.stats?.mageClass);
        if (!skill) return;
        const btn = this.$('mobile-nova-btn');
        if (btn) {
            this._novaLabel = btn.textContent;
            btn.textContent = skill.title.toUpperCase();
        }
        const hint = this.$('mana-hint');
        if (hint) {
            this._hintHTML = hint.innerHTML;
            hint.innerHTML = `Press <kbd>Tab</kbd> or <kbd>Enter</kbd> to cast ${skill.title}!`;
        }
    }

    _restoreCastSurfaces() {
        const btn = this.$('mobile-nova-btn');
        if (btn && this._novaLabel != null) btn.textContent = this._novaLabel;
        const hint = this.$('mana-hint');
        if (hint && this._hintHTML != null) hint.innerHTML = this._hintHTML;
        this._novaLabel = null;
        this._hintHTML = null;
    }

    /**
     * The armed-skill chip, painted for BOTH slots (host left / challenger
     * right). Unarmed it names the skill and its cost — the arena's only warning
     * about what the other mage can do — and armed it lights up, so the same
     * fact is readable on both screens instead of only on the caster's.
     */
    _renderBuff(suffix, slot) {
        const el = this.$('sb-buff-' + suffix);
        if (!el) return;
        const armedId = this.buffs[slot];
        const skill = armedId
            ? mageActiveById(armedId)
            : (this.classes[slot] ? activeForClass(this.classes[slot]) : null);
        if (!skill) {
            el.textContent = '';
            el.classList.add('hidden');
            return;
        }
        el.classList.remove('hidden');
        el.textContent = armedId
            ? `PVP ACTIVE · ${skill.title.toUpperCase()} ★`
            : `PVP ACTIVE · ${skill.title} · ${skill.cost}`;
        el.classList.toggle('sb-buff-armed', !!armedId);
    }

    /**
     * Take the host's armed map. The host spends buffs inside `_resolve()`; if a
     * caster only ever learned about their own arm, their chip would stay lit
     * after the host spent it (or dark after the host armed theirs) — a
     * one-client-only state, which is exactly what these invariants forbid.
     * Absent field = older frame, leave what we have.
     */
    _adoptBuffs(p) {
        if (!p || !p.armed) return;
        this.buffs = { A: p.armed.A || null, B: p.armed.B || null };
        if (p.buffUntil) {
            const now = Date.now();
            this.buffUntil.A = Number(p.buffUntil.A) || 0;
            this.buffUntil.B = Number(p.buffUntil.B) || 0;
            if (this.buffUntil.A && this.buffUntil.A <= now) {
                this.buffUntil.A = 0;
                this.buffs.A = null;
            }
            if (this.buffUntil.B && this.buffUntil.B <= now) {
                this.buffUntil.B = 0;
                this.buffs.B = null;
            }
            this.game.duelBuffUntil = this.buffUntil;
        }
    }

    _adoptAuras(p) {
        if (!p || !p.auras) return;
        this.game.duelAuras.A = p.auras.A || null;
        this.game.duelAuras.B = p.auras.B || null;
    }

    _adoptDebuffs(p) {
        if (!p || !p.debuffs) return;
        const now = Date.now();
        this.debuffs = {
            A: p.debuffs.A && (!p.debuffs.A.until || p.debuffs.A.until >= now) ? p.debuffs.A : null,
            B: p.debuffs.B && (!p.debuffs.B.until || p.debuffs.B.until >= now) ? p.debuffs.B : null
        };
        this.game.duelDebuffs = this.debuffs;
    }

    _adoptCombos(p) {
        if (!p || !p.combos) return;
        this.duelCombos.A = Math.max(0, Math.floor(Number(p.combos.A) || 0));
        this.duelCombos.B = Math.max(0, Math.floor(Number(p.combos.B) || 0));
        this.game.duelCombos = this.duelCombos;
    }

    _adoptTimeStop(p) {
        if (!p || typeof p.timeStopUntil !== 'number') return;
        this.timeStopUntil = p.timeStopUntil;
        this.timeStopSlot = p.timeStopSlot || null;
        this.game.duelTimeStopUntil = p.timeStopUntil;
        this.game.duelTimeStopSlot = this.timeStopSlot;
    }

    // ── transport ────────────────────────────────────────────────────────
    _onRace(p) {
        if (this.over) return;
        // AT-L6: every race frame carries its sender's display name, so the
        // opponent's name heals from the WIRE the moment they first speak —
        // that closes the join() placeholder (presence can still be syncing
        // when the race starts, and on the host side no frame has arrived yet
        // at word #1). A frame from ourselves (Duel filters these) must never
        // overwrite the opponent's side with our own name.
        if (p.player_name && p.player_key !== this.duel.presenceKey &&
            p.player_name !== this.names[this.theirs]) {
            this.names[this.theirs] = p.player_name;
            if (this.game.duelOpponent) this.game.duelOpponent.name = p.player_name;
            this._renderNames();
        }
        switch (p.raceType) {
            case 'issue': if (!this.isHost) this._onIssue(p); break;
            case 'cast': this._onCast(p); break;
            case 'combo': this._onComboFrame(p); break;
            case 'time_stop': this._onTimeStop(p); break;
            case 'claim': if (this.isHost) this._onClaim(p); break;
            case 'taken': this._onTaken(p); break;
            case 'state': if (!this.isHost) this._onState(p); break;
            case 'result': if (!this.isHost) this._onResult(p); break;
            case 'match_over': if (!this.isHost) this._onMatchOver(p); break;
        }
    }

    _onIssue(p) {
        if (typeof p.idx !== 'number' || p.idx <= this.idx) return; // dup/late
        this._clearWords(); // heal any gap (missed issue)
        this.idx = p.idx;
        this._spawnLocal(p.text, p.x, p.baseSpeed);
    }

    _onClaim(p) {
        if (p.player_key && p.player_key === this.duel.presenceKey) return; // never self-echo
        if (this.phase !== 'word' || p.idx !== this.idx || this.oppResolved) return;
        this.oppResolved = true;
        if (!p.forfeited && typeof p.dur === 'number') this.oppClaim = p.dur;
        // P3: a claim is in — give OUR in-flight claim CLAIM_WINDOW_MS to land,
        // then arbitrate. Without this a dissolved word could park the lane
        // (the other side can no longer claim at all, so "wait for both
        // claims" would never be satisfied).
        this._armWindow();
        this._maybeResolve();
    }

    /**
     * AT-F9 P3: the opponent typed the word first. The race is decided, so the
     * word must be GONE from this screen immediately — owner report: "when the
     * word is already been typed by the other player, it should also vanish in
     * the 2nd player screen". Previously it kept falling, could shatter on the
     * loser's own mage and only cleared when the next word was issued.
     * Pure visual: no damage, no expiry hook, arbitration untouched.
     */
    _onTaken(p) {
        if (p.player_key && p.player_key === this.duel.presenceKey) return; // never self-echo
        if (this.phase !== 'word' || p.idx !== this.idx || this.myDecided) return;
        this.myDecided = true;   // our keystrokes can no longer claim this word
        const taker = this.theirs;
        this.game.dissolveRaceWord(teamColorFor(taker), this.game.duelOpponent?.character || 'wizard');
        this._floatAtSlot(taker, 'TAKEN!', teamColorFor(taker), 26);
        // Defensive: the paired `claim` may be lost in flight; the host must
        // still resolve this word inside the window instead of wedging.
        this._armWindow();
    }

    _onState(p) {
        this.hp.A = p.hpA; this.hp.B = p.hpB;
        this.wins.A = p.winsA; this.wins.B = p.winsB;
        if (typeof p.timeLeft === 'number') this.timeLeft = p.timeLeft;
        this.overtime = !!p.overtime;
        this._adoptBuffs(p);
        this._adoptAuras(p);
        this._adoptDebuffs(p);
        this._adoptCombos(p);
        this._adoptTimeStop(p);
        this._render();
    }

    _onResult(p) {
        if (typeof p.idx === 'number' && p.idx < this.idx) return; // stale
        this.phase = 'result';
        this._applyResult(p);
        if (p.matchOver) {
            this.over = true;
            clearTimeout(this._pauseTimer);
            this._pauseTimer = setTimeout(() => this._finishBy(p.matchWinner, p.reason), RESULT_PAUSE_MS + 300);
        }
        // Next issue arrives from the host — guests never self-schedule.
    }

    _onMatchOver(p) {
        this.hp.A = p.hpA; this.hp.B = p.hpB;
        this.wins.A = p.winsA; this.wins.B = p.winsB;
        if (typeof p.timeLeft === 'number') this.timeLeft = p.timeLeft;
        this.overtime = !!p.overtime;
        this.over = true;
        clearTimeout(this._leaveTimer);
        clearTimeout(this._leaveFloatTimer);
        clearInterval(this._clockTimer);
        clearInterval(this._stateTimer);
        this._render();
        this._pauseTimer = setTimeout(() => this._finishBy(p.winner, p.reason), 400);
    }

    // ── presence grace (5 s, owner decision) ─────────────────────────────
    _onOpponentLeft() {
        if (this.over || this._leaveTimer) return;
        this._leaveTimer = setTimeout(() => {
            this._leaveTimer = null;
            // A background tab can cause Supabase to emit leave/join around
            // visibility changes. Before forfeiting, trust the settled presence
            // state rather than the raw leave event; the owner-approved grace
            // remains five seconds for a genuinely absent opponent.
            if (this._opponentIsPresent()) {
                clearTimeout(this._leaveFloatTimer);
                this._leaveFloatTimer = null;
                this._float('OPPONENT RECONNECTED', '#4caf50', 26);
                return;
            }
            this._endMatch(this.mine, 'disconnect');
        }, DISCONNECT_GRACE_MS);
        // Delay the on-canvas warning: a clean forfeit's match_over normally
        // lands in <500 ms and must be allowed to clarify the story first —
        // seeing DISCONNECTING-then-YIELDED was the owner-reported mixup.
        this._leaveFloatTimer = setTimeout(() => {
            if (!this.over) this._float('OPPONENT DISCONNECTING…', '#ff9800', 28);
        }, 1500);
    }

    _onOpponentRejoined() {
        if (this.over) return;
        if (this._leaveTimer) {
            clearTimeout(this._leaveTimer);
            clearTimeout(this._leaveFloatTimer);
            this._leaveTimer = null;
            this._leaveFloatTimer = null;
            this._float('OPPONENT RECONNECTED', '#4caf50', 26);
        }
    }

    _opponentIsPresent() {
        try {
            const state = this.duel.channel?.presenceState?.() || {};
            return Object.keys(state).some((key) => key !== this.duel.presenceKey);
        } catch (err) {
            return false;
        }
    }

    _clearWords() {
        this.game.words.length = 0; // duel mode: only the race word exists
        if (this.game.targetedWord) {
            this.game.targetedWord.isTargeted = false;
            this.game.targetedWord = null;
        }
    }

    // ── score bar rendering ─────────────────────────────────────────────
    _renderNames() {
        const a = this.$('sb-name-a');
        const b = this.$('sb-name-b');
        if (a) a.textContent = this.names.A + (this.mine === 'A' ? ' (YOU)' : '');
        if (b) b.textContent = this.names.B + (this.mine === 'B' ? ' (YOU)' : '');
        this.$('sb-side-a')?.classList.toggle('sb-you', this.mine === 'A');
        this.$('sb-side-b')?.classList.toggle('sb-you', this.mine === 'B');
    }

    _render() {
        const pa = Math.max(0, Math.min(100, (this.hp.A / START_HP) * 100));
        const pb = Math.max(0, Math.min(100, (this.hp.B / START_HP) * 100));
        const fa = this.$('sb-hp-fill-a'); if (fa) fa.style.width = pa + '%';
        const fb = this.$('sb-hp-fill-b'); if (fb) fb.style.width = pb + '%';
        const va = this.$('sb-hpval-a'); if (va) va.textContent = String(this.hp.A);
        const vb = this.$('sb-hpval-b'); if (vb) vb.textContent = String(this.hp.B);
        const wa = this.$('sb-wins-a'); if (wa) wa.textContent = String(this.wins.A);
        const wb = this.$('sb-wins-b'); if (wb) wb.textContent = String(this.wins.B);
        const t = this.$('sb-timer');
        if (t) {
            const m = Math.floor(this.timeLeft / 60);
            const s = this.timeLeft % 60;
            t.textContent = `${m}:${String(s).padStart(2, '0')}`;
            t.classList.toggle('sb-low', this.timeLeft <= 15 && !this.overtime);
        }
        this.$('sb-flag')?.classList.toggle('hidden', !this.overtime);
        // AT-F10: both mages' actives, repainted on every frame that can change
        // them (start / heartbeat / result).
        this._renderBuff('a', 'A');
        this._renderBuff('b', 'B');
    }

    _float(text, color, size) {
        const c = this.game.canvas;
        this.game.floatingTexts.push(new FloatingText(text, c.width / 2, c.height / 3, color, size));
    }

    /**
     * AT-F9 P3: player-anchored feedback. Anything that belongs to ONE mage
     * (a steal, a forfeit, damage) is drawn over THAT mage's fixed team slot —
     * left for the host, right for the challenger — in that team's colour.
     * Owner decision: no centring, no mirroring; each player's effect always
     * reads from their own side of the lane.
     */
    _floatAtSlot(slot, text, color, size, lift = 0) {
        const c = this.game.canvas;
        this.game.floatingTexts.push(
            new FloatingText(text, this.game.duelSlotX(slot), c.height - 130 - lift, color, size)
        );
    }

    _shake(side) {
        const el = this.$('sb-side-' + side);
        if (!el) return;
        el.classList.remove('sb-hit');
        void el.offsetWidth;
        el.classList.add('sb-hit');
    }
}
