export class Projectile {
    constructor(x, y, targetX, targetY, colors, type = 'normal') {
        this.x = x;
        this.y = y;
        this.targetX = targetX;
        this.targetY = targetY;
        this.colors = colors || ['#ffd700', '#ffffff'];
        this.type = type; // 'normal' | 'gojo_blue' | 'gojo_red' | 'sukuna_slash'

        this.speed = 400; // pixels per second (fast)
        this.radius = 8;
        this.isDead = false;

        const dx = targetX - x;
        const dy = targetY - y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        this.vx = (dx / distance) * this.speed;
        this.vy = (dy / distance) * this.speed;

        this.trail = []; // Keep a longer history for trail effect
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

        if (this.type === 'sukuna_slash') {
            // Dismantle barrage — draw 3 thin parallel slash lines
            ctx.globalAlpha = 1.0;
            ctx.strokeStyle = this.colors[0];
            ctx.shadowColor = this.colors[0];
            ctx.shadowBlur = window.__atLowQuality ? 0 : 12;
            ctx.lineCap = 'round';
            
            const angle = Math.atan2(this.vy, this.vx);
            ctx.translate(this.x, this.y);
            ctx.rotate(angle + Math.PI / 2);
            
            // Draw 3 thin slash arcs with slight offsets
            for (let i = -1; i <= 1; i++) {
                const offset = i * 6;
                const slashWidth = i === 0 ? 2.5 : 1.5;
                ctx.lineWidth = slashWidth;
                ctx.beginPath();
                ctx.arc(offset, 0, 12, -Math.PI / 3, Math.PI / 3);
                ctx.stroke();
            }
            
            // Bright white core on center slash
            ctx.strokeStyle = '#ffffff';
            ctx.shadowBlur = window.__atLowQuality ? 0 : 6;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(0, 0, 12, -Math.PI / 4, Math.PI / 4);
            ctx.stroke();
            
            ctx.restore();
            return;
        }

        if (this.type === 'sukuna_cleave') {
            // Massive full-width Cleave slash — a thick brilliant line
            ctx.globalAlpha = 1.0;
            
            const angle = Math.atan2(this.vy, this.vx);
            ctx.translate(this.x, this.y);
            ctx.rotate(angle + Math.PI / 2);
            
            // Outer glow slash
            ctx.strokeStyle = this.colors[0];
            ctx.shadowColor = this.colors[0];
            ctx.shadowBlur = window.__atLowQuality ? 0 : 25;
            ctx.lineWidth = 5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(0, 0, 25, -Math.PI / 3, Math.PI / 3);
            ctx.stroke();
            
            // Inner bright core
            ctx.strokeStyle = '#ffea00';
            ctx.shadowColor = '#ffea00';
            ctx.shadowBlur = window.__atLowQuality ? 0 : 15;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, 25, -Math.PI / 4, Math.PI / 4);
            ctx.stroke();
            
            // White hot center
            ctx.strokeStyle = '#ffffff';
            ctx.shadowBlur = window.__atLowQuality ? 0 : 8;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(0, 0, 25, -Math.PI / 6, Math.PI / 6);
            ctx.stroke();
            
            ctx.restore();
            return;
        }

        if (this.type === 'gojo_blue' || this.type === 'gojo_red') {
            // High energy orb with trailing energy rings
            if (this.trail.length > 1) {
                for (let i = 1; i < this.trail.length; i++) {
                    const t = i / this.trail.length;
                    const alpha = t * 0.55;
                    ctx.beginPath();
                    ctx.arc(this.trail[i].x, this.trail[i].y, this.radius * (0.4 + 0.6 * t), 0, Math.PI * 2);
                    ctx.strokeStyle = this.colors[0];
                    ctx.lineWidth = 1.5;
                    ctx.globalAlpha = alpha;
                    ctx.shadowColor = this.colors[0];
                    ctx.shadowBlur = window.__atLowQuality ? 0 : 8 * t;
                    ctx.stroke();
                }
            }

            ctx.globalAlpha = 1.0;
            ctx.shadowColor = this.colors[0];
            ctx.shadowBlur = window.__atLowQuality ? 0 : 25;
            
            // Outer glowing core
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fillStyle = this.colors[0];
            ctx.fill();

            // Inner white core
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = window.__atLowQuality ? 0 : 5;
            ctx.fill();
            
            ctx.restore();
            return;
        }

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
