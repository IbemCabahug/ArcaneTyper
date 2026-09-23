/**
 * DuelRace.js — AT-F9 shared-arena word race controller.
 *
 * One word at a time, issued by the HOST; the quickest CORRECT typist wins
 * the race and deals word-length damage to the opponent's 100 HP instantly.
 * Match ends: KO (0 HP) | clock (120 s; equal HP → OVERTIME sudden death)
 * | disconnect grace (5 s) | forfeit. Words never damage. A mistake forfeits
 * the word to your opponent (both mistake → word expires, no damage).
 *
 * Fairness: durations are measured from each client's OWN word-appearance
 * (latency cancels out); the host arbitrates after both claims or local
 * expiry + grace; |Δ| < 75 ms = dead heat → nobody scores.
 */
import { FloatingText } from '../FloatingText.js';

const START_HP = 100;
const MATCH_SECONDS = 120;
const DMG_PER_CHAR = 1;              // damage = word length × scalar (AT-F9)
const CLAIM_GRACE_MS = 900;          // in-flight claim wait after local expiry
const RESULT_PAUSE_MS = 700;         // banner beat between words
const DEAD_HEAT_MS = 75;             // nobody scores inside this window
const DISCONNECT_GRACE_MS = 5000;    // presence-leave grace (owner decision)
const ISSUE_WATCHDOG_MS = 15000;     // host safety: word must resolve by then

export class DuelRace {
    constructor({ game, duel, isHost, opponentName, onMatchEnd }) {
        this.game = game;
        this.duel = duel;
        this.isHost = isHost;
        this.onMatchEnd = onMatchEnd;
        // Fixed team slots: A = host (blue, left), B = guest (red, right).
        this.mine = isHost ? 'A' : 'B';
        this.theirs = isHost ? 'B' : 'A';
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
        this.oppResolved = false;
        this.oppClaim = null;

        this._graceTimer = null;
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

        // Game hooks (Phase 0 'duel' gates invoke these only in duel mode)
        this.game.onRaceWordExpired = () => this._onLocalExpiry();
        this.game.onRaceTyped = () => this._onTyped();
        this.game.onRaceMistake = () => this._onMistake();

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
        clearTimeout(this._pauseTimer);
        clearTimeout(this._watchdog);
        clearTimeout(this._leaveTimer);
        clearTimeout(this._leaveFloatTimer);
        clearInterval(this._clockTimer);
        clearInterval(this._stateTimer);
        this.game.onRaceWordExpired = null;
        this.game.onRaceTyped = null;
        this.game.onRaceMistake = null;
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
        this.oppResolved = false;
        this.oppClaim = null;
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

        const dmg = winner ? this.currentText.length * DMG_PER_CHAR : 0;
        const loser = winner ? (winner === 'A' ? 'B' : 'A') : null;
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
            idx: this.idx, winner, dmg,
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
        this._render();

        if (r.winner === this.mine) {
            this._float(`OPPONENT −${r.dmg} HP`, '#ffd700', 34);
        } else if (r.winner === this.theirs) {
            this._float('OPPONENT STRIKES!', '#ff4b4b', 36);
        } else {
            this._float('WORD LOST', '#b892b0', 30);
        }
        if (r.winner) this._shake(r.winner === 'A' ? 'b' : 'a');
    }

    _endMatch(winner, reason) {
        if (this.over) return;
        this.over = true;
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
        if (this.over || this.phase !== 'word' || this.myResolved) return;
        this.myResolved = true;
        if (this.myForfeited) return;
        const dur = Math.max(1, Math.round(performance.now() - this.appearAt));
        if (this.isHost) {
            this.myClaim = dur;
            this._maybeResolve();
        } else {
            this.duel.broadcastRace('claim', { idx: this.idx, dur });
        }
    }

    _onMistake() {
        if (this.over || this.phase !== 'word' || this.myResolved) return;
        // AT-F9: one mistake forfeits the current word to your opponent.
        this.myResolved = true;
        this.myForfeited = true;
        this._float('WORD FORFEITED!', '#ff4b4b', 30);
        if (this.isHost) {
            this._maybeResolve();
        } else {
            this.duel.broadcastRace('claim', { idx: this.idx, forfeited: true });
        }
    }

    // ── transport ────────────────────────────────────────────────────────
    _onRace(p) {
        if (this.over) return;
        switch (p.raceType) {
            case 'issue': if (!this.isHost) this._onIssue(p); break;
            case 'claim': if (this.isHost) this._onClaim(p); break;
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
        if (this.phase !== 'word' || p.idx !== this.idx || this.oppResolved) return;
        this.oppResolved = true;
        if (!p.forfeited && typeof p.dur === 'number') this.oppClaim = p.dur;
        this._maybeResolve();
    }

    _onState(p) {
        this.hp.A = p.hpA; this.hp.B = p.hpB;
        this.wins.A = p.winsA; this.wins.B = p.winsB;
        if (typeof p.timeLeft === 'number') this.timeLeft = p.timeLeft;
        this.overtime = !!p.overtime;
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
    }

    _float(text, color, size) {
        const c = this.game.canvas;
        this.game.floatingTexts.push(new FloatingText(text, c.width / 2, c.height / 3, color, size));
    }

    _shake(side) {
        const el = this.$('sb-side-' + side);
        if (!el) return;
        el.classList.remove('sb-hit');
        void el.offsetWidth;
        el.classList.add('sb-hit');
    }
}
