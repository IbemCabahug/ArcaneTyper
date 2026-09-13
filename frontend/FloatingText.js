export class FloatingText {
    constructor(text, x, y, color = '#ffd700', size = 24) {
        this.text = text;
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = size;
        this.life = 1.0;
        this.decay = 0.02; // roughly 50 frames to fade
        this.vy = -1.5; // Drift upwards
    }

    update(dt) {
        const timeScale = dt / 16;
        this.y += this.vy * timeScale;
        this.life -= this.decay * timeScale;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.font = `bold ${this.size}px Cinzel, serif`;
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = window.__atLowQuality ? 0 : 8;
        ctx.textAlign = 'center';
        ctx.fillText(this.text, this.x, this.y);
        ctx.restore();
    }
}
