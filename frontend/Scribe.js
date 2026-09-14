export class Scribe {
    constructor(dictionary, stats) {
        this.dictionary = dictionary;
        this.stats = stats;

        this.container = document.getElementById('practice-text-container');
        this.wpmDisplay = document.getElementById('practice-wpm');
        this.accDisplay = document.getElementById('practice-acc');
        this.timerDisplay = document.getElementById('scribe-timer-display');

        this.resultsMenu = document.getElementById('practice-results');
        this.resWpm = document.getElementById('practice-res-wpm');
        this.resRawWpm = document.getElementById('practice-res-raw-wpm');
        this.resAcc = document.getElementById('practice-res-acc');
        this.resConsistency = document.getElementById('practice-res-consistency');

        this.words = [];
        this.wordElements = []; // array of { letters: spanEl[], extras: spanEl[], locked: bool }

        this.currentWordIdx = 0;
        this.currentLetterIdx = 0;

        this.isRunning = false;
        this.tickInterval = null;

        // Mode: 'words' | 'timed'
        this.mode = 'words';
        this.duration = 30; // seconds (timed mode)
        this.timeLeft = 30;

        // Stats
        this.startTime = null;
        this.keystrokes = 0;       // all presses
        this.correctKeystrokes = 0;
        this.rawKeystrokes = 0;    // every character key (for raw WPM)

        // Per-second WPM sampling
        this.wpmSamples = [];
        this._secondsElapsed = 0;
        this.currentStreak = 0;
        this.maxStreak = 0;

        this.inputReady = false;
    }

    // ─── Public start/stop ────────────────────────────────────────────────────

    start(mode = 'words', duration = 30) {
        this.mode = mode;
        this.duration = duration;
        this.timeLeft = duration;

        this.resultsMenu.classList.add('hidden');
        this.container.innerHTML = '';

        this.words = [];
        this.wordElements = [];
        this.currentWordIdx = 0;
        this.currentLetterIdx = 0;

        this.startTime = null;
        this.keystrokes = 0;
        this.currentStreak = 0;
        this.maxStreak = 0;
        this.correctKeystrokes = 0;
        this.rawKeystrokes = 0;
        this.wpmSamples = [];
        this._secondsElapsed = 0;

        // Generate initial word set
        if (this.mode === 'timed') {
            this._appendParagraphs(2); // start with a big buffer (2 paragraphs)
            this._updateTimerDisplay();
        } else {
            const paragraph = this.dictionary.getRandomParagraph();
            this.words = paragraph.split(' ');
            this._renderAllWords();
        }

        this.updateHUD();
        this.isRunning = true;
        this.inputReady = false;
        setTimeout(() => { this.inputReady = true; }, 100);
    }

    stop() {
        this.isRunning = false;
        this.inputReady = false;
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
    }

    // ─── Word / DOM helpers ───────────────────────────────────────────────────

    _appendParagraphs(count = 1) {
        for (let i = 0; i < count; i++) {
            const paragraph = this.dictionary.getRandomParagraph();
            const paraWords = paragraph.split(' ');

            paraWords.forEach(w => {
                this.words.push(w);
                this._renderWord(w, this.words.length - 1);
            });
        }
    }

    _renderAllWords() {
        this.container.innerHTML = '';
        this.wordElements = [];
        this.words.forEach((w, i) => this._renderWord(w, i));
        this._updateCursor();
    }

    _renderWord(wordText, idx) {
        const wordEl = document.createElement('div');
        wordEl.className = 'word';
        wordEl.dataset.idx = idx;

        const letterEls = [];
        for (let i = 0; i < wordText.length; i++) {
            const span = document.createElement('span');
            span.className = 'letter';
            span.textContent = wordText[i];
            wordEl.appendChild(span);
            letterEls.push(span);
        }

        this.container.appendChild(wordEl);
        this.wordElements[idx] = { el: wordEl, letters: letterEls, extras: [], locked: false };

        if (idx === this.currentWordIdx) {
            this._updateCursor();
        }
    }

    _updateCursor() {
        // Remove all active cursors
        this.container.querySelectorAll('.active').forEach(el => el.classList.remove('active'));

        const entry = this.wordElements[this.currentWordIdx];
        if (!entry) return;

        const { letters } = entry;
        if (this.currentLetterIdx < letters.length) {
            letters[this.currentLetterIdx].classList.add('active');
        } else if (entry.extras.length > 0) {
            // cursor after last extra
            entry.extras[entry.extras.length - 1].classList.add('active');
        } else {
            // cursor at end of word — show after last letter
            if (letters.length > 0) {
                letters[letters.length - 1].classList.add('active-after');
            }
        }

        // Scroll into view smoothly at word boundaries
        if (this.currentLetterIdx === 0 && this.isRunning) {
            entry.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // ─── MonkeyType-style key handling ───────────────────────────────────────

    handleKeyDown(e) {
        if (!this.isRunning || !this.inputReady) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key.length > 1 && e.key !== 'Backspace' && e.key !== ' ') return;

        // Start timer / clock on first real keystroke
        if (!this.startTime && e.key !== 'Backspace') {
            this.startTime = Date.now();
            this._startTick();
        }

        if (e.key === 'Backspace') {
            this._handleBackspace();
        } else if (e.key === ' ') {
            this._handleSpace();
        } else {
            this._handleChar(e.key);
        }

        this.updateHUD();
    }

    _handleChar(key) {
        const entry = this.wordElements[this.currentWordIdx];
        if (!entry || entry.locked) return;

        this.rawKeystrokes++;
        this.keystrokes++;

        if (this.currentLetterIdx < entry.letters.length) {
            // Normal letter
            const expected = this.words[this.currentWordIdx][this.currentLetterIdx];
            const letterEl = entry.letters[this.currentLetterIdx];

            if (key === expected) {
                this.correctKeystrokes++;
                this.currentStreak++;
                if (this.currentStreak > this.maxStreak) this.maxStreak = this.currentStreak;
                letterEl.className = 'letter correct';

                // Typing Spark
                const spark = document.createElement('span');
                spark.className = 'typing-spark';

                // Randomize spark direction slightly
                const angle = Math.random() * Math.PI;
                const distance = 15 + Math.random() * 15;
                const dx = Math.cos(angle) * distance;
                const dy = -Math.sin(angle) * distance - 10;

                spark.style.setProperty('--dx', `${dx}px`);
                spark.style.setProperty('--dy', `${dy}px`);
                spark.style.left = '50%';
                spark.style.top = '50%';

                letterEl.appendChild(spark);
                setTimeout(() => spark.remove(), 400);

            } else {
                this.currentStreak = 0;
                letterEl.className = 'letter incorrect';
            }
            this.currentLetterIdx++;
        } else {
            // Over-typed — append red extra span
            const extra = document.createElement('span');
            extra.className = 'letter extra incorrect';
            extra.textContent = key;
            entry.el.appendChild(extra);
            entry.extras.push(extra);
        }

        this._updateCursor();
    }

    _handleSpace() {
        const entry = this.wordElements[this.currentWordIdx];
        if (!entry || entry.locked) return;

        // Count skipped (untyped) letters as wrong keystrokes — affects accuracy
        const remaining = entry.letters.length - this.currentLetterIdx;
        if (remaining > 0) {
            this.currentStreak = 0;
            this.keystrokes += remaining;
            // correctKeystrokes is NOT incremented — these are errors
            for (let i = this.currentLetterIdx; i < entry.letters.length; i++) {
                entry.letters[i].className = 'letter incorrect';
            }
        }

        // Lock this word
        entry.locked = true;
        entry.el.classList.add('word-done');

        // Advance
        this.currentWordIdx++;
        this.currentLetterIdx = 0;

        // In timed mode, append more paragraphs when buffer is running low
        if (this.mode === 'timed' && this.currentWordIdx > this.words.length - 30) {
            this._appendParagraphs(1);
        }

        // In words mode: finished all words?
        if (this.mode === 'words' && this.currentWordIdx >= this.words.length) {
            this.finishTrial();
            return;
        }

        this._updateCursor();
    }

    _handleBackspace() {
        const entry = this.wordElements[this.currentWordIdx];
        if (!entry || entry.locked) return;

        if (entry.extras.length > 0) {
            // Remove last extra letter
            const extra = entry.extras.pop();
            extra.remove();
        } else if (this.currentLetterIdx > 0) {
            // Un-type last letter in current word
            this.currentLetterIdx--;
            entry.letters[this.currentLetterIdx].className = 'letter';
        }
        // Cannot backspace across word boundary (word is locked after space)

        this._updateCursor();
    }

    // ─── Timer / tick ─────────────────────────────────────────────────────────

    _startTick() {
        if (this.tickInterval) clearInterval(this.tickInterval);

        this.tickInterval = setInterval(() => {
            this._secondsElapsed++;

            // Record a WPM sample every second
            const wpm = this.getWPM();
            if (wpm > 0) this.wpmSamples.push(wpm);

            if (this.mode === 'timed') {
                this.timeLeft = Math.max(0, this.duration - this._secondsElapsed);
                this._updateTimerDisplay();

                if (this.timeLeft <= 0) {
                    this.finishTrial();
                }
            }

            this.updateHUD();
        }, 1000);
    }

    _updateTimerDisplay() {
        if (this.timerDisplay) {
            this.timerDisplay.textContent = this.timeLeft;
            if (this.timeLeft <= 5) {
                this.timerDisplay.style.color = 'var(--accent-danger)';
            } else {
                this.timerDisplay.style.color = 'var(--accent-primary)';
            }
        }
    }

    // ─── Stat calculations ────────────────────────────────────────────────────

    getWPM() {
        if (!this.startTime || this.correctKeystrokes === 0) return 0;
        const minutes = (Date.now() - this.startTime) / 60000;
        if (minutes === 0) return 0;
        return Math.round((this.correctKeystrokes / 5) / minutes);
    }

    getRawWPM() {
        if (!this.startTime || this.rawKeystrokes === 0) return 0;
        const minutes = (Date.now() - this.startTime) / 60000;
        if (minutes === 0) return 0;
        return Math.round((this.rawKeystrokes / 5) / minutes);
    }

    getAccuracy() {
        if (this.keystrokes === 0) return 100;
        return Math.round((this.correctKeystrokes / this.keystrokes) * 100);
    }

    getConsistency() {
        const samples = this.wpmSamples;
        if (samples.length < 2) return 100;
        const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
        if (mean === 0) return 100;
        const variance = samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length;
        const stdDev = Math.sqrt(variance);
        return Math.max(0, Math.round(100 - (stdDev / mean) * 100));
    }

    // ─── HUD & results ───────────────────────────────────────────────────────

    updateHUD() {
        this.wpmDisplay.innerText = this.getWPM();
        this.accDisplay.innerText = this.getAccuracy();
    }

    finishTrial() {
        this.stop();

        const wpm = this.getWPM();
        const rawWpm = this.getRawWPM();
        const accuracy = this.getAccuracy();
        const consistency = this.getConsistency();

        this.resWpm.innerText = wpm;
        if (this.resRawWpm) this.resRawWpm.innerText = rawWpm;
        if (this.resAcc) this.resAcc.innerText = accuracy;
        if (this.resConsistency) this.resConsistency.innerText = consistency;

        this.resultsMenu.classList.remove('hidden');

        const scribeScore = Math.floor(wpm * (accuracy / 100)) * 10;

        // Log to Supabase and Add XP
        if (this.stats) {
            if (this.stats.addXP) this.stats.addXP(Math.floor(scribeScore / 10));
            if (this.stats.logRunToSupabase) this.stats.logRunToSupabase('scribe', wpm, accuracy, scribeScore);
        }

        if (this.onTrialComplete) {
            this.onTrialComplete(wpm, rawWpm, accuracy, consistency, [...this.wpmSamples], this.maxStreak);
        }
    }
}
