
/**
 * ArenaSigils.js — procedural PvP active sigils.
 * The final enclosing ring gives each class a shared seal language; the
 * interior paths identify the active without relying on emoji/font glyphs.
 */
const EFFECTS = {
    'arcane-surge': { color: '#a855f7', accent: '#e9d5ff' },
    'cinder-brand': { color: '#ff6b35', accent: '#ffd166' },
    'glacial-ward': { color: '#4dd0e1', accent: '#c7f9ff' },
    'time-stop': { color: '#c084fc', accent: '#f3e8ff' }
};

function glow(ctx, color, blur) {
    if (!window.__atLowQuality) {
        ctx.shadowColor = color;
        ctx.shadowBlur = blur;
    }
}

function polygon(ctx, points, color, width) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
}

function drawNova(ctx, r) {
    polygon(ctx, [[0, -r], [r * .62, 0], [0, r], [-r * .62, 0]], EFFECTS['arcane-surge'].accent, 2);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.moveTo(Math.cos(a) * r * .28, Math.sin(a) * r * .28);
        ctx.lineTo(Math.cos(a) * r * .96, Math.sin(a) * r * .96);
    }
    ctx.strokeStyle = EFFECTS['arcane-surge'].color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * .18, 0, Math.PI * 2);
    ctx.fillStyle = EFFECTS['arcane-surge'].accent;
    ctx.fill();
}

function drawPyro(ctx, r) {
    polygon(ctx, [[0, -r], [r * .9, r * .72], [-r * .9, r * .72]], EFFECTS['cinder-brand'].accent, 2);
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
        const x = i * r * .42;
        ctx.moveTo(x, r * .48);
        ctx.quadraticCurveTo(x - r * .18, r * .12, x, -r * .2);
        ctx.quadraticCurveTo(x + r * .18, -r * .05, x, r * .48);
    }
    ctx.strokeStyle = EFFECTS['cinder-brand'].color;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, r * .28, r * .14, 0, Math.PI * 2);
    ctx.fillStyle = '#fff3b0';
    ctx.fill();
}

function drawCryo(ctx, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.moveTo(Math.cos(a) * r * .18, Math.sin(a) * r * .18);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        const side = a + Math.PI / 2;
        ctx.moveTo(Math.cos(a) * r * .58, Math.sin(a) * r * .58);
        ctx.lineTo(Math.cos(side) * r * .24, Math.sin(side) * r * .24);
        ctx.moveTo(Math.cos(a) * r * .58, Math.sin(a) * r * .58);
        ctx.lineTo(Math.cos(side + Math.PI) * r * .24, Math.sin(side + Math.PI) * r * .24);
    }
    ctx.strokeStyle = EFFECTS['glacial-ward'].accent;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * .28, 0, Math.PI * 2);
    ctx.strokeStyle = EFFECTS['glacial-ward'].color;
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawChronoMark(ctx, r) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = EFFECTS['time-stop'].accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8));
        ctx.strokeStyle = i % 3 === 0 ? EFFECTS['time-stop'].accent : EFFECTS['time-stop'].color;
        ctx.stroke();
    }
    polygon(ctx, [[-r * .28, -r * .42], [r * .28, -r * .42], [-r * .28, r * .42], [r * .28, r * .42]], '#ffffff', 1.5);
}

export function drawCasterSigil(ctx, skillId, x, y, radius, now, alpha = 1) {
    const effect = EFFECTS[skillId];
    if (!effect) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    glow(ctx, effect.color, skillId === 'time-stop' ? 18 : 10);
    ctx.save();
    ctx.rotate(now / (skillId === 'time-stop' ? -900 : 1200));
    const inner = radius * .64;
    if (skillId === 'arcane-surge') drawNova(ctx, inner);
    else if (skillId === 'cinder-brand') drawPyro(ctx, inner);
    else if (skillId === 'glacial-ward') drawCryo(ctx, inner);
    else drawChronoMark(ctx, inner);
    ctx.restore();
    // Final layer: the enclosing circle seals every class sigil.
    ctx.globalAlpha = alpha * .52;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 8, now / 1200, now / 1200 + Math.PI * 1.35);
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
}

export function drawTimeStopSeal(ctx, width, height, remainingMs, now) {
    const cx = width / 2, cy = height / 2;
    const scale = Math.min(1.2, Math.max(.82, height / 750));
    const r = Math.round(Math.min(width, height) * .42 * scale);
    const effect = EFFECTS['time-stop'];
    const progress = Math.max(0, Math.min(1, remainingMs / 3000));
    const pulse = .5 + .5 * Math.sin(now / 260);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = .18 + pulse * .08;
    glow(ctx, effect.color, 18);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 1;
    for (const ring of [r * .55, r * .78, r]) {
        ctx.beginPath(); ctx.arc(0, 0, ring, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = .78;
    ctx.lineWidth = 2;
    ctx.save();
    ctx.rotate(now / -1100);
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a) * (r - (i % 3 === 0 ? 17 : 9)), Math.sin(a) * (r - (i % 3 === 0 ? 17 : 9)));
    }
    ctx.strokeStyle = effect.accent;
    ctx.stroke();
    ctx.restore();
    ctx.rotate(-now / 1600);
    polygon(ctx, [[-22, -34], [22, -34], [-22, 34], [22, 34]], effect.accent, 2);
    ctx.rotate(now / 1600);
    // Final layer: the bright arc is the Chronomancer's expiry counter.
    ctx.beginPath(); ctx.arc(0, 0, r + 12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(192,132,252,.18)'; ctx.lineWidth = 5; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.strokeStyle = effect.accent; ctx.lineWidth = 5;
    ctx.shadowColor = effect.accent; ctx.shadowBlur = window.__atLowQuality ? 0 : 14; ctx.stroke();
    ctx.restore();
}

