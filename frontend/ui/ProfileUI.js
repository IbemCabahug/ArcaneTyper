import { MagicalToast } from './MagicalToast.js';

export class ProfileUI {
    constructor(game) {
        this.game = game;

        // DOM Elements
        this.menuBestScore = document.getElementById('menu-best-score');
        this.menuBestWpm = document.getElementById('menu-best-wpm');
        this.menuBestStreak = document.getElementById('menu-best-streak');
        this.levelEl = document.getElementById('menu-player-level');
        this.xpBarEl = document.getElementById('menu-xp-bar');
        this.wandGlows = document.querySelectorAll('.mage-wand-glow-img');

        // Character selection cards
        this.skinCards = document.querySelectorAll('.skin-card');
        this.setupSkinSelection();
    }

    setupSkinSelection() {
        this.skinCards.forEach(card => {
            card.addEventListener('click', () => {
                const charId = card.getAttribute('data-char');
                if (!this.game.stats) return;

                if (this.game.stats.isCharacterUnlocked(charId)) {
                    this.game.stats.setSelectedCharacter(charId);
                    this.updateSkinCardsUI();
                    
                    const name = charId === 'wizard' ? 'GRAND CHRONO-ARCHMAGE' : charId.toUpperCase();
                    MagicalToast.show(`Bound to avatar: <span style="color:#00e5ff; font-weight:bold;">${name}</span>`);
                    if (this.game.audio) this.game.audio.playSound('click');
                } else {
                    MagicalToast.show(`<span style="color:#ffd700; font-weight:bold;">IN FORGE:</span> This original class is currently being forged!`);
                    if (this.game.audio) this.game.audio.playErrorSound();
                }
            });
        });
    }

    updateSkinCardsUI() {
        if (!this.game.stats) return;
        const currentSelected = this.game.stats.selectedCharacter || 'wizard';

        this.skinCards.forEach(card => {
            const charId = card.getAttribute('data-char');
            const isUnlocked = this.game.stats.isCharacterUnlocked(charId);
            
            // Toggle active state
            if (charId === currentSelected) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }

            // Toggle locked state
            const statusEl = card.querySelector('.skin-status');
            if (isUnlocked) {
                card.classList.remove('locked');
                if (statusEl) {
                    statusEl.innerText = "UNLOCKED";
                    statusEl.style.color = "#00e5ff";
                }
            } else {
                card.classList.add('locked');
                if (statusEl) {
                    statusEl.innerText = "LOCKED";
                    statusEl.style.color = "#ff5252";
                }
            }
        });
    }

    updateProgressionUI() {
        if (!this.game.stats) return;
        if (this.levelEl) this.levelEl.innerText = this.game.stats.playerLevel || 1;
        if (this.xpBarEl) {
            this.xpBarEl.style.width = (this.game.stats.getXPProgress ? this.game.stats.getXPProgress() : 0) + '%';
        }
    }

    updateMenuStats() {
        if (this.menuBestScore) this.menuBestScore.innerText = this.game.stats.bestScore;
        if (this.menuBestWpm) this.menuBestWpm.innerText = this.game.stats.bestWPM;
        if (this.menuBestStreak) this.menuBestStreak.innerText = this.game.stats.bestStreak || 0;

        // Update Avatar Wand Color
        this.wandGlows.forEach(glow => {
            glow.style.backgroundColor = this.game.stats.wandColor;
            glow.style.boxShadow = `0 0 15px 5px ${this.game.stats.wandColor}66`; // 66 is hex for roughly 40% opacity
        });

        this.updateProgressionUI();
        this.updateSkinCardsUI();
        this.drawHistoryChart();
    }

    // Renders the "WPM History (Last 10 Runs)" panel (AT-M2). Data comes from
    // a localStorage ring buffer fed by Stats.recordWpm on every run end,
    // so it works for guests and offline players too.
    drawHistoryChart() {
        const canvas = document.getElementById('profile-history-chart');
        if (!canvas || !this.game.stats || !this.game.stats.getWpmHistory) return;

        const ctx = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        const history = this.game.stats.getWpmHistory();

        ctx.clearRect(0, 0, W, H);

        if (history.length === 0) {
            ctx.fillStyle = '#b892b0';
            ctx.font = '11px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('Complete runs to forge your legend', W / 2, H / 2);
            return;
        }

        const pad = 10;
        const maxWpm = Math.max(...history, 20);
        const stepX = history.length > 1 ? (W - pad * 2) / (history.length - 1) : 0;
        const yFor = (wpm) => H - pad - (wpm / maxWpm) * (H - pad * 2);

        // Baseline + peak guide line
        ctx.strokeStyle = 'rgba(184, 146, 176, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad, H - pad);
        ctx.lineTo(W - pad, H - pad);
        ctx.stroke();

        // WPM polyline
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        history.forEach((wpm, i) => {
            const x = pad + i * stepX;
            const y = yFor(wpm);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Data points (latest highlighted)
        history.forEach((wpm, i) => {
            const x = pad + i * stepX;
            const y = yFor(wpm);
            const isLatest = i === history.length - 1;
            ctx.fillStyle = isLatest ? '#00e5ff' : '#ffd700';
            ctx.beginPath();
            ctx.arc(x, y, isLatest ? 4 : 2.5, 0, Math.PI * 2);
            ctx.fill();
        });

        // Latest value label
        const lastX = pad + (history.length - 1) * stepX;
        const lastY = yFor(history[history.length - 1]);
        ctx.fillStyle = '#00e5ff';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${history[history.length - 1]}`, Math.min(lastX, W - 4), lastY - 6);
    }
}
