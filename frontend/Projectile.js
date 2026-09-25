export class Projectile {
    constructor(x, y, targetX, targetY, colors, type = 'normal', wordLength = 0) {
        this.x = x;
        this.y = y;
        this.targetX = targetX;
        this.targetY = targetY;
        this.colors = colors || ['#ffd700', '#ffffff'];
        this.type = type;
        // Carried so the boss strike can scale with the solved word's length
        // (the Wizard's steady profile). Defaults to 0 for every other caller.
        this.wordLength = Number.isFinite(wordLength) && wordLength > 0 ? wordLength : 0;

        this.speed = 400; // pixels per second (fast)
        this.radius = 8;
        this.isDead = false;

        const dx = targetX - x;
        const dy = targetY - y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        this.vx = (dx / distance) * this.speed;
        this.vy = (dy / distance) * this.speed;

        this.trail = []; // Keep a history for trail effect
    }

    update(dt) {
        if (this.isDead) return;

        // Save history for trail
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 12) {
            this.trail.shift();
        }

        this.x += this.vx * (dt / 1000);
        this.y += this.vy * (dt / 1000);

        // Check if we reached/passed the target
        if (this.y <= this.targetY + 20) {
            this.isDead = true;
        }
    }

    draw(ctx) {
        if (this.isDead) return;

        ctx.save();

        // Draw tapered trail — older segments are thinner and more transparent
        if (this.trail.length > 1) {
            for (let i = 1; i < this.trail.length; i++) {
                const t = i / this.trail.length; // 0 = oldest, 1 = newest
                const alpha = t * 0.6;
                const width = t * this.radius * 1.5;

                ctx.beginPath();
                ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
                ctx.lineTo(this.trail[i].x, this.trail[i].y);
                ctx.strokeStyle = this.colors[0];
                ctx.lineWidth = Math.max(1, width);
                ctx.lineCap = 'round';
                ctx.globalAlpha = alpha;
                ctx.shadowColor = this.colors[0];
                ctx.shadowBlur = window.__atLowQuality ? 0 : 10 * t;
                ctx.stroke();
            }
        }

        // Draw glowing core
        ctx.globalAlpha = 1.0;
        ctx.shadowColor = this.colors[0];
        ctx.shadowBlur = window.__atLowQuality ? 0 : 20;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.colors[1] || '#ffffff';
        ctx.fill();

        // Bright inner core
        ctx.shadowBlur = window.__atLowQuality ? 0 : 5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        ctx.restore();
    }
}
