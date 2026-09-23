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
import { activeForClass, mageActiveById } from '../../backend/MageClasses.js';

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
        this.game.duelOpponent = {
            name: this.names[this.theirs],
            character: oppPresence?.character || 'wizard',
            wand: oppPresence?.wand || null
        };
        // AT-F10: both Disciplines — ours from stats, theirs from the presence the
        // duel already tracks — then label the cast surfaces and repaint the
        // chips (the first _render above predates both).
        this.classes[this.mine] = this.game.stats?.mageClass || null;
        this.classes[this.theirs] = oppPresence?.mage_class || null;
        this._labelCastSurfaces();
        this._render();

        // Game hooks (Phase 0 'duel' gates invoke these only in duel mode)
        this.game.onRaceWordExpired = () => this._onLocalExpiry();
        this.game.onRaceTyped = () => this._onTyped();
        this.game.onRaceMistake = () => this._onMistake();
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
        clearInterval(this._clockTimer);
        clearInterval(this._stateTimer);
        this.game.onRaceWordExpired = null;
        this.game.onRaceTyped = null;
        this.game.onRaceMistake = null;
        this.game.onDuelCast = null;   // AT-F10: Tab is the ultimate again
        // AT-F10: disarm both slots, blank both chips and hand the input
        // surfaces back to their own wording — a duel must leave no trace in the
        // Survival HUD (the same contract the score bar follows).
        this.buffs = { A: null, B: null };
        this.classes = { A: null, B: null };
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
            armed: { A: this.buffs.A, B: this.buffs.B },
            hpA: this.hp.A, hpB: this.hp.B,
            winsA: this.wins.A, winsB: this.wins.B,
            timeLeft: this.timeLeft, overtime: this.overtime
        };
    }

    // ── host: clock & heartbeat ──────────────────────────────────────────
    _tickClock() {
        if (this.over || this.overtime) return; // overtime parks clock at 0:00
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
        this._graceTimer = setTimeout(() => {
            if (this.over || this.phase !== 'word') return;
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

        const loser = winner ? (winner === 'A' ? 'B' : 'A') : null;

        // AT-F10: the winner is decided FIRST, and only then may an active edit
        // the outcome. Nothing here reads or writes a measured duration — the
        // arbiter's own input stays untouched (this is why Chronomancer's
        // original 0.85x version was replaced by Mana Echo).
        const dmgRaw = winner ? this.currentText.length * DMG_PER_CHAR : 0;
        let dmg = dmgRaw;
        let amp = null;    // the winning skill that shaped this strike
        let ward = null;   // the losing skill that absorbed it
        const winnerBuff = winner ? mageActiveById(this.buffs[winner]) : null;
        const loserBuff = winner ? mageActiveById(this.buffs[loser]) : null;
        if (winnerBuff && winnerBuff.kind === 'damage') {
            dmg = Math.round(dmg * winnerBuff.value);
            amp = winnerBuff.id;
        }
        if (loserBuff && loserBuff.kind === 'mitigation') {
            dmg = Math.round(dmg * loserBuff.value);
            ward = loserBuff.id;
        }
        // Mana Echo moves the WINNER's own pool instead of the damage, so it is
        // flagged here (the frame is what makes both sides agree it fired) and
        // paid out on the winner's client in _applyResult.
        if (winnerBuff && winnerBuff.kind === 'mana_refund') amp = winnerBuff.id;

        // Spent = the buff actually did something. A dead heat or a double
        // forfeit has no winner, so nothing is spent and both mages stay armed:
        // a rule both clients derive from THIS frame, never from local timing.
        // A ward is only spent when it had damage to absorb; a Cryomancer who
        // WINS the word keeps it for the next loss.
        if (winner) {
            if (winnerBuff && winnerBuff.kind !== 'mitigation') this.buffs[winner] = null;
            if (loserBuff && loserBuff.kind === 'mitigation') this.buffs[loser] = null;
        }

        if (winner) {
            this.hp[loser] = Math.max(0, this.hp[loser] - dmg);
            this.wins[winner]++;
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
            armed: { A: this.buffs.A, B: this.buffs.B },
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
        this._render();

        if (r.winner === this.mine) {
            // We struck — the damage landed on THEIR mage, so the number
            // belongs over their side of the lane, not over the centre.
            this._floatAtSlot(this.theirs, `OPPONENT −${r.dmg} HP`, '#ffd700', 30);
            if (r.amp) {
                // The skill line rides above the damage line it explains.
                const skill = mageActiveById(r.amp);
                if (skill) this._floatAtSlot(this.theirs, `${skill.title.toUpperCase()}!`, '#ff9800', BUFF_FLOAT_SIZE, BUFF_FLOAT_LIFT);
                // The refund belongs to the mage who won the claim, so only the
                // winner's own client pays it — into the pool they cast from.
                if (skill && skill.kind === 'mana_refund') {
                    const got = this.game.stats?.refundMana?.(skill.value) || 0;
                    this._floatAtSlot(this.mine, `+${got} MANA`, '#29b6f6', BUFF_FLOAT_SIZE, BUFF_FLOAT_LIFT);
                }
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
        // The cost comes out of OUR OWN pool: mana is local-only state, and the
        // same is true of the refund Mana Echo pays back in _applyResult.
        if (!this.game.stats.useMana(skill.cost)) {
            this._floatAtSlot(this.mine, 'NOT ENOUGH MANA', '#ff9800', BUFF_FLOAT_SIZE, BUFF_FLOAT_LIFT);
            this.game.audio?.playErrorSound?.();
            return true;
        }
        this.buffs[this.mine] = skill.id;
        this.game.audio?.playMagicSpark?.();
        this._floatAtSlot(this.mine, `${skill.title.toUpperCase()} ARMED!`, teamColorFor(this.mine), BUFF_FLOAT_SIZE);
        // One frame, host-authoritative. A buff has to survive a word we never
        // claimed (Glacial Ward absorbs a LOSS), which a `claim` payload cannot
        // carry — and announcing it is also what makes it readable to the other
        // mage before it lands.
        this.duel.broadcastRace('cast', { idx: this.idx, skill: skill.id });
        this._render();
        return true;
    }

    /**
     * Host side: the challenger armed a skill. The id is resolved against the
     * roster, so a client cannot invent an effect, and re-arming while armed is
     * refused here exactly as `cast()` refuses it locally — one buff per player,
     * and only the host's map is authoritative.
     */
    _onCast(p) {
        if (!this.isHost || this.over) return;
        if (p.player_key && p.player_key === this.duel.presenceKey) return; // never self-echo
        const skill = mageActiveById(p.skill);
        if (!skill || this.buffs[this.theirs]) return;
        this.buffs[this.theirs] = skill.id;
        this._floatAtSlot(this.theirs, `${skill.title.toUpperCase()} ARMED!`, teamColorFor(this.theirs), BUFF_FLOAT_SIZE);
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
        el.textContent = armedId ? `${skill.title.toUpperCase()} ★` : `${skill.title} · ${skill.cost}`;
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
    }

    // ── transport ────────────────────────────────────────────────────────
    _onRace(p) {
        if (this.over) return;
        switch (p.raceType) {
            case 'issue': if (!this.isHost) this._onIssue(p); break;
            case 'cast': this._onCast(p); break;
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
        this.game.dissolveRaceWord(teamColorFor(taker));
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
            this._float('OPPONENT RECONNECTED', '#4caf50', 26);
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
