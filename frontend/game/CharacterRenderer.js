/**
 * CharacterRenderer — Procedural Sprite & Animation Engine
 *
 * Renders high-fidelity animated character sprites for ArcaneTyper:
 * - The Grand Chrono-Archmage (Wizard): Levitation hover, flowing hooded robes with gold embroidery,
 *   starlight celestial eyes, rotating astrological dial & runic pedestal, combo-scaling ascendant auras,
 *   and dynamic casting staff with player-attuned elemental gem.
 */
export class CharacterRenderer {
    /**
     * Main entry point for drawing the selected character.
     */
    static draw(ctx, x, y, characterId, animProgress, stats, now = performance.now()) {
        ctx.save();
        CharacterRenderer.drawWizard(ctx, x, y, animProgress, stats, now);
        ctx.restore();
    }

    // =========================================================================
    // 1. THE ARCHMAGE (WIZARD) — GRAND CHRONO-ARCHMAGE (REAR PERSPECTIVE)
    // =========================================================================
    static drawWizard(ctx, cx, cy, animProgress, stats, now) {
        // Idle levitation hover
        const hoverY = Math.sin(now / 420) * 3.5;
        const wizX = cx;
        const wizY = cy + hoverY;
        const wandColor = (stats && stats.wandColor) ? stats.wandColor : '#00e5ff';
        const combo = stats ? (stats.combo || 0) : 0;
        const lowQ = window.__atLowQuality;

        ctx.save();

        // ---------------------------------------------------------------------
        // Layer 0: Astrological Chrono-Halo (Framing Upper Back & Cowl)
        // ---------------------------------------------------------------------
        ctx.save();
        const haloY = wizY - 22;
        const haloRadius = combo >= 100 ? 28 : 22;
        const haloRot = now * 0.0006;
        ctx.translate(wizX, haloY);
        ctx.rotate(haloRot);

        // Outer celestial dial ring
        ctx.beginPath();
        ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
        ctx.strokeStyle = combo >= 100 ? '#ffd700' : 'rgba(255, 215, 0, 0.38)';
        ctx.lineWidth = combo >= 100 ? 1.5 : 1.0;
        if (!lowQ && combo >= 50) {
            ctx.shadowColor = wandColor;
            ctx.shadowBlur = 8;
        }
        ctx.stroke();

        // 8 Dial Ticks with 4 Cardinal Starlight Points
        for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4;
            const isCardinal = i % 2 === 0;
            const r1 = haloRadius - (isCardinal ? 3.5 : 2.0);
            const r2 = haloRadius + (isCardinal ? 3.5 : 2.0);
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
            ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
            ctx.strokeStyle = isCardinal ? wandColor : 'rgba(255, 255, 255, 0.45)';
            ctx.lineWidth = isCardinal ? 1.4 : 0.8;
            ctx.stroke();
        }

        // Combo >= 100: Inner Reverse-Rotating Dashed Celestial Dial
        if (combo >= 100) {
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.strokeStyle = wandColor;
            ctx.lineWidth = 1.0;
            ctx.setLineDash([3, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();

        // ---------------------------------------------------------------------
        // Layer 1: Grand Arcane Mandala & Celestial Armillary (Option 1 & 4)
        // ---------------------------------------------------------------------
        const mandalaX = wizX;
        const mandalaY = wizY - 14;

        if (combo >= 10) {
            ctx.save();
            ctx.translate(mandalaX, mandalaY);

            const speedMult = 1.0 + Math.min(2.5, combo * 0.012);
            const rotClockwise = now * 0.0008 * speedMult;
            const rotCounter = -now * 0.0012 * speedMult;
            const pulse = Math.sin(now / 320) * 1.5;

            // --- Tier 1 (10+ Combo): Inner Sacred Rune Ring ---
            ctx.save();
            ctx.rotate(rotClockwise);
            ctx.strokeStyle = combo >= 50 ? '#ffd700' : 'rgba(255, 215, 0, 0.45)';
            ctx.lineWidth = combo >= 50 ? 1.5 : 1.0;
            if (!lowQ && combo >= 25) {
                ctx.shadowColor = wandColor;
                ctx.shadowBlur = combo >= 50 ? 10 : 6;
            }
            ctx.beginPath();
            ctx.arc(0, 0, 24 + pulse * 0.5, 0, Math.PI * 2);
            ctx.stroke();

            // 4 Cardinal Starlight Needles on Inner Ring
            for (let i = 0; i < 4; i++) {
                const a = (i * Math.PI) / 2;
                ctx.beginPath();
                ctx.moveTo(Math.cos(a) * 20, Math.sin(a) * 20);
                ctx.lineTo(Math.cos(a) * 28, Math.sin(a) * 28);
                ctx.strokeStyle = wandColor;
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
            ctx.restore();

            // --- Tier 2 (25+ Combo): Dashed Counter-Rotating Astrolabe Dial ---
            if (combo >= 25) {
                ctx.save();
                ctx.rotate(rotCounter);
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
                ctx.lineWidth = 1.2;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.arc(0, 0, 36 + pulse * 0.8, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);

                // 8 Astrological Tick Marks
                for (let i = 0; i < 8; i++) {
                    const a = (i * Math.PI) / 4;
                    ctx.fillStyle = (i % 2 === 0) ? '#ffd700' : '#00e5ff';
                    ctx.beginPath();
                    ctx.arc(Math.cos(a) * 36, Math.sin(a) * 36, 1.4, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            // --- Tier 3 (50+ Combo): The Grand Arcane Mandala (Sacred Hexagram) ---
            if (combo >= 50) {
                const alpha50 = Math.min(0.95, 0.55 + (combo - 50) * 0.008);
                ctx.save();
                ctx.globalAlpha = alpha50;

                // Ethereal Radial Aether Bloom
                const bloomRadius = 54 + pulse * 2;
                const bloom = ctx.createRadialGradient(0, 0, 10, 0, 0, bloomRadius);
                bloom.addColorStop(0, 'rgba(0, 229, 255, 0.22)');
                bloom.addColorStop(0.5, 'rgba(213, 0, 249, 0.12)');
                bloom.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = bloom;
                ctx.beginPath();
                ctx.arc(0, 0, bloomRadius, 0, Math.PI * 2);
                ctx.fill();

                // Outer Runic Boundary Wheel (52px)
                ctx.save();
                ctx.rotate(rotClockwise * 0.6);
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 1.8;
                if (!lowQ) {
                    ctx.shadowColor = '#ffd700';
                    ctx.shadowBlur = 12;
                }
                ctx.beginPath();
                ctx.arc(0, 0, 52 + pulse, 0, Math.PI * 2);
                ctx.stroke();

                // Concentric inner companion ring
                ctx.beginPath();
                ctx.arc(0, 0, 48 + pulse, 0, Math.PI * 2);
                ctx.lineWidth = 0.9;
                ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
                ctx.stroke();

                // 8 Compass Rays extending outward from wheel
                for (let r = 0; r < 8; r++) {
                    const ra = (r * Math.PI) / 4;
                    const isMajor = r % 2 === 0;
                    const rLen = isMajor ? (62 + pulse) : (56 + pulse);
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(ra) * 48, Math.sin(ra) * 48);
                    ctx.lineTo(Math.cos(ra) * rLen, Math.sin(ra) * rLen);
                    ctx.strokeStyle = isMajor ? '#ffd700' : 'rgba(0, 229, 255, 0.7)';
                    ctx.lineWidth = isMajor ? 1.5 : 1.0;
                    ctx.stroke();
                }
                ctx.restore();

                // Sacred Hexagram (Interlocking Equilateral Triangles, R=42px)
                ctx.save();
                ctx.rotate(rotCounter * 0.8);
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.75)';
                ctx.lineWidth = 1.2;
                if (!lowQ) {
                    ctx.shadowColor = '#00e5ff';
                    ctx.shadowBlur = 8;
                }
                for (let t = 0; t < 2; t++) {
                    const offset = (t * Math.PI) / 3;
                    ctx.beginPath();
                    for (let p = 0; p < 3; p++) {
                        const pa = offset + (p * Math.PI * 2) / 3;
                        const px = Math.cos(pa) * 42;
                        const py = Math.sin(pa) * 42;
                        if (p === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.stroke();
                }

                // Hexagram Vertex Glyphs (6 Golden Star Points)
                for (let v = 0; v < 6; v++) {
                    const va = (v * Math.PI) / 3;
                    ctx.fillStyle = '#ffd700';
                    ctx.beginPath();
                    ctx.arc(Math.cos(va) * 42, Math.sin(va) * 42, 1.8, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
                ctx.restore();
            }

            // --- Tier 4 (75+ Combo): 12-Segment Zodiac Astrolabe Matrix ---
            if (combo >= 75) {
                ctx.save();
                ctx.rotate(rotClockwise * 1.2);
                ctx.strokeStyle = 'rgba(213, 0, 249, 0.65)';
                ctx.lineWidth = 1.0;
                ctx.beginPath();
                ctx.arc(0, 0, 60 + pulse * 1.2, 0, Math.PI * 2);
                ctx.stroke();

                for (let z = 0; z < 12; z++) {
                    const za = (z * Math.PI) / 6;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(za) * 56, Math.sin(za) * 56);
                    ctx.lineTo(Math.cos(za) * 60, Math.sin(za) * 60);
                    ctx.strokeStyle = '#d500f9';
                    ctx.lineWidth = 1.0;
                    ctx.stroke();
                }
                ctx.restore();
            }

            // --- Tier 5 (100+ Combo): Ascendant Dodecagram (12-Pointed Star Matrix) ---
            if (combo >= 100) {
                ctx.save();
                ctx.rotate(rotCounter * 0.5);
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 1.4;
                if (!lowQ) {
                    ctx.shadowColor = '#ffd700';
                    ctx.shadowBlur = 14;
                }

                // Outer Celestial Dial Ring (68px)
                ctx.beginPath();
                ctx.arc(0, 0, 68 + pulse * 1.5, 0, Math.PI * 2);
                ctx.stroke();

                // 4 Interlocking Equilateral Triangles forming 12-pointed Star
                for (let s = 0; s < 4; s++) {
                    const sOffset = (s * Math.PI) / 6;
                    ctx.beginPath();
                    for (let sp = 0; sp < 3; sp++) {
                        const spa = sOffset + (sp * Math.PI * 2) / 3;
                        const spx = Math.cos(spa) * 66;
                        const spy = Math.sin(spa) * 66;
                        if (sp === 0) ctx.moveTo(spx, spy);
                        else ctx.lineTo(spx, spy);
                    }
                    ctx.closePath();
                    ctx.stroke();
                }
                ctx.restore();
            }

            // --- Tier 6 (150+ Combo): 3D Gyroscopic Armillary Rings ---
            if (combo >= 150) {
                ctx.save();
                const gyroRotX = now * 0.0018;
                const gyroRotY = now * 0.0022;

                // Equatorial Armillary Ring (horizontal perspective ellipse)
                ctx.save();
                ctx.rotate(gyroRotX);
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
                ctx.lineWidth = 1.6;
                if (!lowQ) {
                    ctx.shadowColor = '#00e5ff';
                    ctx.shadowBlur = 10;
                }
                ctx.beginPath();
                ctx.ellipse(0, 0, 76 + pulse * 2, 22 + pulse * 0.5, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();

                // Polar Armillary Ring (vertical perspective ellipse)
                ctx.save();
                ctx.rotate(gyroRotY + Math.PI / 3);
                ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
                ctx.lineWidth = 1.6;
                if (!lowQ) {
                    ctx.shadowColor = '#ffd700';
                    ctx.shadowBlur = 10;
                }
                ctx.beginPath();
                ctx.ellipse(0, 0, 76 + pulse * 2, 22 + pulse * 0.5, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                ctx.restore();
            }

            // --- Tier 7 (200+ Combo): Cosmic Singularity Core (Infinite Escalation) ---
            if (combo >= 200) {
                ctx.save();
                const bonusR = Math.min(24, Math.floor((combo - 200) / 50) * 5);
                const singR = 82 + bonusR + pulse * 2.5;

                // Blinding Singularity Halo
                const singGrad = ctx.createRadialGradient(0, 0, 5, 0, 0, singR);
                singGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
                singGrad.addColorStop(0.4, 'rgba(0, 229, 255, 0.25)');
                singGrad.addColorStop(0.8, 'rgba(213, 0, 249, 0.15)');
                singGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = singGrad;
                ctx.beginPath();
                ctx.arc(0, 0, singR, 0, Math.PI * 2);
                ctx.fill();

                // Outermost Singularity Ring
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.8;
                if (!lowQ) {
                    ctx.shadowColor = '#ffffff';
                    ctx.shadowBlur = 16;
                }
                ctx.beginPath();
                ctx.arc(0, 0, singR, 0, Math.PI * 2);
                ctx.stroke();

                ctx.restore();
            }

            ctx.restore(); // Restore from translate(mandalaX, mandalaY)
        }

        // --- Ethereal Orbiting Lexicon: Background Leaves (Math.sin(angle) < 0) ---
        const numLeaves = combo >= 200 ? 12 : (combo >= 150 ? 10 : (combo >= 100 ? 8 : (combo >= 50 ? 6 : (combo >= 25 ? 4 : (combo >= 10 ? 2 : 0)))));
        const leafSpeedMult = 1.0 + Math.min(2.5, combo * 0.01);
        const leafOrbitRx = 46 + (combo >= 100 ? 10 : 0);
        const leafOrbitRy = 20 + (combo >= 100 ? 6 : 0);

        if (numLeaves > 0) {
            for (let l = 0; l < numLeaves; l++) {
                const lAngle = (now * 0.0016 * leafSpeedMult) + (l * Math.PI * 2) / numLeaves;
                if (Math.sin(lAngle) < 0) {
                    const lx = wizX + Math.cos(lAngle) * leafOrbitRx;
                    const ly = (wizY - 14) + Math.sin(lAngle) * leafOrbitRy;
                    CharacterRenderer._drawLexiconLeaf(ctx, lx, ly, lAngle, now, l, false, wandColor, lowQ);
                }
            }
        }

        // ---------------------------------------------------------------------
        // Layer 2: Ascendant Runic Ground Pedestal (Combo-Scaling)
        // ---------------------------------------------------------------------
        const pedestalY = cy + 22;
        ctx.save();
        ctx.translate(wizX, pedestalY);
        ctx.scale(1, 0.35); // Flatten to perspective ellipse

        const pPulse = Math.sin(now / 350) * 0.15;
        const pAlpha = combo >= 10 ? (0.65 + pPulse) : (0.42 + pPulse);

        // Primary outer arcane circle
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.strokeStyle = wandColor;
        ctx.lineWidth = combo >= 10 ? 2.0 : 1.4;
        ctx.globalAlpha = pAlpha;
        if (!lowQ && combo >= 10) {
            ctx.shadowColor = wandColor;
            ctx.shadowBlur = 10;
        }
        ctx.stroke();

        // Combo >= 10: Secondary Inner Circle with Counter-Spinning Glyphs
        if (combo >= 10) {
            ctx.beginPath();
            ctx.arc(0, 0, 17, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = pAlpha * 0.85;
            ctx.stroke();

            const innerAngle = -now * 0.0016;
            for (let t = 0; t < 6; t++) {
                const a = innerAngle + (t / 6) * Math.PI * 2;
                ctx.beginPath();
                ctx.arc(Math.cos(a) * 17, Math.sin(a) * 17, 1.4, 0, Math.PI * 2);
                ctx.fillStyle = '#ffd700';
                ctx.fill();
            }
        }

        // Rotating outer glyph ticks
        const speedMult = combo >= 10 ? 2.4 : 1.0;
        const tickCount = 8;
        const glyphAngle = now * 0.0008 * speedMult;
        for (let t = 0; t < tickCount; t++) {
            const a = glyphAngle + (t / tickCount) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * 26, Math.sin(a) * 26, 1.8, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
        ctx.restore();

        // ---------------------------------------------------------------------
        // Layer 3: Floating Astral Grimoire (Left Side)
        // ---------------------------------------------------------------------
        ctx.save();
        const bookHover = Math.sin(now / 320) * 2.0;
        const bookX = wizX - 22;
        const bookY = wizY - 6 + bookHover;
        const bookAngle = -0.16 + Math.sin(now / 400) * 0.05;

        ctx.translate(bookX, bookY);
        ctx.rotate(bookAngle);

        // Grimoire Tome Binding & Leather Cover
        ctx.fillStyle = '#21101e';
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(-13, -11, 26, 22, 2.5);
        ctx.fill();
        ctx.stroke();

        // Open Fluttering Parchment Pages
        const flutter = Math.sin(now / 160) * 0.8;
        // Left Page
        ctx.fillStyle = '#f4eedb';
        ctx.beginPath();
        ctx.moveTo(-1, -8);
        ctx.lineTo(-10, -9 + flutter * 0.4);
        ctx.lineTo(-10, 8 + flutter * 0.4);
        ctx.lineTo(-1, 9);
        ctx.closePath();
        ctx.fill();

        // Right Page
        ctx.fillStyle = '#eadebe';
        ctx.beginPath();
        ctx.moveTo(1, -8);
        ctx.lineTo(10, -9 - flutter * 0.4);
        ctx.lineTo(10, 8 - flutter * 0.4);
        ctx.lineTo(1, 9);
        ctx.closePath();
        ctx.fill();

        // Spine Inlay
        ctx.strokeStyle = '#c5a059';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(0, 9);
        ctx.stroke();

        // Hovering Runic Glyph above Pages
        const glyphGlow = Math.sin(now / 220) * 2.5 + 4;
        ctx.fillStyle = wandColor;
        ctx.font = 'bold 8px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (!lowQ) {
            ctx.shadowColor = wandColor;
            ctx.shadowBlur = glyphGlow;
        }
        ctx.fillText('✦', 0, -4);

        // Typing Spark Emissions from Grimoire
        if (animProgress > 0) {
            ctx.save();
            ctx.fillStyle = '#ffd700';
            ctx.globalAlpha = animProgress;
            for (let s = 0; s < 3; s++) {
                const sx = (s - 1) * 5;
                const sy = -12 - animProgress * 14 - s * 3;
                ctx.beginPath();
                ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
        ctx.restore();

        // ---------------------------------------------------------------------
        // Layer 4: Upward Resonance Staff (Right Side)
        // ---------------------------------------------------------------------
        ctx.save();
        const staffRecoil = animProgress > 0 ? (animProgress * 0.22) : 0;
        const staffAngle = 0.24 - staffRecoil + Math.sin(now / 550) * 0.03;
        const staffBaseX = wizX + 15;
        const staffBaseY = wizY - 4;

        ctx.translate(staffBaseX, staffBaseY);
        ctx.rotate(staffAngle);

        // Staff Shaft (Obsidian duskwood with golden spiral inlays)
        ctx.fillStyle = '#221515';
        ctx.fillRect(-2, -44, 4.2, 50);
        ctx.strokeStyle = '#432924';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-2, -44, 4.2, 50);

        // Golden spiral filigree bindings
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.0;
        for (let b = 0; b < 3; b++) {
            const by = -10 - b * 12;
            ctx.beginPath();
            ctx.moveTo(-2, by);
            ctx.lineTo(2, by - 3);
            ctx.stroke();
        }

        // Twin Golden Crescent Prongs
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(0, -46, 7.5, Math.PI * 0.2, Math.PI * 0.8, true);
        ctx.stroke();

        // Gyroscopic Orbital Ring
        const ringAngle = now * 0.003;
        ctx.save();
        ctx.translate(0, -50);
        ctx.rotate(ringAngle);
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.7)';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 2.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Floating Faceted Prism Crystal
        const gemHover = Math.sin(now / 240) * 1.5;
        const gemGlow = 10 + Math.sin(now / 260) * 6 + animProgress * 22;
        ctx.save();
        ctx.translate(0, -50 + gemHover);
        ctx.rotate(now * 0.002);

        // Faceted Diamond Geometry
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(5.5, 0);
        ctx.lineTo(0, 8);
        ctx.lineTo(-5.5, 0);
        ctx.closePath();

        ctx.fillStyle = wandColor;
        if (!lowQ) {
            ctx.shadowColor = wandColor;
            ctx.shadowBlur = gemGlow;
        }
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.0;
        ctx.stroke();

        // Internal facet highlight
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(2.5, 0);
        ctx.lineTo(0, 8);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.stroke();

        // Combo >= 25: Radial Starlight Flare Rays from Crystal
        if (combo >= 25) {
            const flareLen = 8 + Math.sin(now / 180) * 3;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 1.2;
            for (let f = 0; f < 4; f++) {
                const fa = (f * Math.PI) / 2 + now * 0.002;
                ctx.beginPath();
                ctx.moveTo(Math.cos(fa) * 6, Math.sin(fa) * 6);
                ctx.lineTo(Math.cos(fa) * (6 + flareLen), Math.sin(fa) * (6 + flareLen));
                ctx.stroke();
            }
        }
        ctx.restore();

        // Attack Spell Discharge Flare & Upward Lance
        if (animProgress > 0) {
            ctx.save();
            ctx.translate(0, -50);

            // Radiant burst core
            ctx.beginPath();
            ctx.arc(0, 0, 14 * animProgress, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${animProgress * 0.85})`;
            if (!lowQ) {
                ctx.shadowColor = wandColor;
                ctx.shadowBlur = 25;
            }
            ctx.fill();

            // Upward starlight lance shooting into cosmos
            const lanceLength = 45 * animProgress;
            ctx.beginPath();
            ctx.moveTo(-3 * animProgress, 0);
            ctx.lineTo(0, -lanceLength);
            ctx.lineTo(3 * animProgress, 0);
            ctx.fillStyle = wandColor;
            ctx.fill();
            ctx.restore();
        }

        ctx.restore();

        // ---------------------------------------------------------------------
        // Layer 5: Rear-View Archmage Silhouette & Constellation Cloak
        // ---------------------------------------------------------------------
        const hemWave = Math.sin(now / 380) * 2.8;

        // Robe Undershadow Depth
        ctx.fillStyle = '#090312';
        ctx.beginPath();
        ctx.moveTo(wizX - 18, wizY + 18);
        ctx.lineTo(wizX - 13, wizY - 14);
        ctx.lineTo(wizX + 13, wizY - 14);
        ctx.lineTo(wizX + 18, wizY + 18);
        ctx.closePath();
        ctx.fill();

        // Cascading Velvet/Obsidian Cloak Body (Seen from Behind)
        ctx.fillStyle = '#140824';
        ctx.strokeStyle = '#321f4c';
        ctx.lineWidth = 1.3;

        ctx.beginPath();
        ctx.moveTo(wizX, wizY - 22);
        ctx.lineTo(wizX - 17 + hemWave * 0.4, wizY + 19);
        ctx.quadraticCurveTo(wizX, wizY + 23 + hemWave, wizX + 17 + hemWave * 0.4, wizY + 19);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Cloak Velvet Depth Shading Folds
        ctx.strokeStyle = '#221138';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(wizX - 5, wizY - 10);
        ctx.lineTo(wizX - 7 + hemWave * 0.3, wizY + 18);
        ctx.moveTo(wizX + 5, wizY - 10);
        ctx.lineTo(wizX + 7 + hemWave * 0.3, wizY + 18);
        ctx.stroke();

        // Golden Embroidered Hem Trim with Runic Edge
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(wizX - 16 + hemWave * 0.4, wizY + 18);
        ctx.quadraticCurveTo(wizX, wizY + 22 + hemWave, wizX + 16 + hemWave * 0.4, wizY + 18);
        ctx.stroke();

        // Secondary inner gold hem thread
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.45)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(wizX - 15 + hemWave * 0.4, wizY + 15.5);
        ctx.quadraticCurveTo(wizX, wizY + 19.5 + hemWave, wizX + 15 + hemWave * 0.4, wizY + 15.5);
        ctx.stroke();

        // ---------------------------------------------------------------------
        // Golden Astrological Constellation Tree (Embroidered on Cloak Back)
        // ---------------------------------------------------------------------
        const starNodes = [
            { x: wizX, y: wizY + 12 },          // Root Lumbar Star
            { x: wizX - 6.5, y: wizY + 6 },     // Lower-Left Star
            { x: wizX + 6.5, y: wizY + 6 },     // Lower-Right Star
            { x: wizX, y: wizY + 1 },           // Center Spine Star
            { x: wizX - 6.0, y: wizY - 4 },     // Mid-Left Star
            { x: wizX + 6.0, y: wizY - 4 },     // Mid-Right Star
            { x: wizX, y: wizY - 9 }            // Upper Nexus Star
        ];

        // Constellation Connecting Lines
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.65)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        // Spine line
        ctx.moveTo(starNodes[0].x, starNodes[0].y);
        ctx.lineTo(starNodes[3].x, starNodes[3].y);
        ctx.lineTo(starNodes[6].x, starNodes[6].y);
        // Lower branch
        ctx.moveTo(starNodes[1].x, starNodes[1].y);
        ctx.lineTo(starNodes[3].x, starNodes[3].y);
        ctx.lineTo(starNodes[2].x, starNodes[2].y);
        // Upper branch
        ctx.moveTo(starNodes[4].x, starNodes[4].y);
        ctx.lineTo(starNodes[6].x, starNodes[6].y);
        ctx.lineTo(starNodes[5].x, starNodes[5].y);
        ctx.stroke();

        // Pulsing Star Nodes
        for (let s = 0; s < starNodes.length; s++) {
            const node = starNodes[s];
            const pulse = 0.8 + Math.sin(now / 280 + s * 0.8) * 0.35;
            ctx.fillStyle = '#fff8e1';
            ctx.beginPath();
            ctx.arc(node.x, node.y, 1.2 * pulse, 0, Math.PI * 2);
            ctx.fill();

            // Tiny cross-glint on key nodes
            if (s === 0 || s === 3 || s === 6) {
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(node.x - 2.5, node.y);
                ctx.lineTo(node.x + 2.5, node.y);
                ctx.moveTo(node.x, node.y - 2.5);
                ctx.lineTo(node.x, node.y + 2.5);
                ctx.stroke();
            }
        }

        // Combo >= 25: Upward Drifting Starlight Embers from Cloak
        if (combo >= 25) {
            ctx.save();
            ctx.fillStyle = wandColor;
            for (let e = 0; e < 3; e++) {
                const emberCycle = ((now * 0.001 + e * 0.33) % 1.0);
                const emberX = wizX - 12 + e * 12 + Math.sin(now / 200 + e) * 3;
                const emberY = (wizY + 16) - emberCycle * 32;
                ctx.globalAlpha = (1 - emberCycle) * 0.8;
                ctx.beginPath();
                ctx.arc(emberX, emberY, 1.1, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // High Mantle & Pauldron Drapes (Upper Back Shoulders)
        ctx.fillStyle = '#1c0c32';
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(wizX - 14, wizY - 14);
        ctx.quadraticCurveTo(wizX, wizY - 8, wizX + 14, wizY - 14);
        ctx.lineTo(wizX + 12, wizY - 21);
        ctx.quadraticCurveTo(wizX, wizY - 17, wizX - 12, wizY - 21);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Spine Brooch / Clasp
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(wizX, wizY - 14, 2.2, 0, Math.PI * 2);
        ctx.fill();

        // ---------------------------------------------------------------------
        // Layer 6: Sculpted Rear Cowl / Hood (Strictly Back Perspective)
        // ---------------------------------------------------------------------
        // Main Hood Curve (Back of Head)
        ctx.fillStyle = '#190a2c';
        ctx.strokeStyle = '#3d255c';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(wizX, wizY - 23, 9.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Tall Sculpted Cowl Peak (Extending upward/back)
        ctx.fillStyle = '#120622';
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(wizX - 9.5, wizY - 22);
        ctx.quadraticCurveTo(wizX, wizY - 19, wizX + 9.5, wizY - 22);
        ctx.lineTo(wizX + 2, wizY - 44);
        ctx.lineTo(wizX - 2, wizY - 44);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Hood Fold Shadow (Spine Crease of Hood)
        ctx.strokeStyle = '#0a0214';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(wizX, wizY - 42);
        ctx.quadraticCurveTo(wizX - 1, wizY - 30, wizX, wizY - 19);
        ctx.stroke();

        // Golden Cowl Border Trim
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(wizX - 8, wizY - 23, 16, 2.4);

        // ---------------------------------------------------------------------
        // Layer 7: Ascendant Archmage Crown & Lightning (Combo >= 100)
        // ---------------------------------------------------------------------
        if (combo >= 100) {
            ctx.save();
            const crownY = wizY - 48 + Math.sin(now / 280) * 1.5;

            // Celestial Constellation Diadem (5 Golden Floating Stars)
            const crownStars = [
                { x: wizX - 12, y: crownY + 2 },
                { x: wizX - 6, y: crownY - 2 },
                { x: wizX, y: crownY - 6 },      // Apex Star
                { x: wizX + 6, y: crownY - 2 },
                { x: wizX + 12, y: crownY + 2 }
            ];

            // Crown Filigree Connecting Arcs
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 1.2;
            if (!lowQ) {
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = 12;
            }
            ctx.beginPath();
            ctx.moveTo(crownStars[0].x, crownStars[0].y);
            for (let c = 1; c < crownStars.length; c++) {
                ctx.lineTo(crownStars[c].x, crownStars[c].y);
            }
            ctx.stroke();

            // Crown Star Nodes
            for (let c = 0; c < crownStars.length; c++) {
                const cs = crownStars[c];
                const isApex = c === 2;
                ctx.fillStyle = isApex ? '#ffffff' : '#ffd700';
                ctx.beginPath();
                ctx.arc(cs.x, cs.y, isApex ? 2.5 : 1.8, 0, Math.PI * 2);
                ctx.fill();
            }

            // Starlight Electricity Micro-Arcs
            ctx.strokeStyle = wandColor;
            ctx.lineWidth = 1.0;
            ctx.globalAlpha = 0.75;
            const arcSeed = Math.floor(now / 80);
            if (arcSeed % 2 === 0) {
                // Arc between Grimoire and Halo
                ctx.beginPath();
                ctx.moveTo(bookX, bookY - 6);
                ctx.lineTo(wizX - 12, wizY - 28);
                ctx.lineTo(wizX - 6, wizY - 36);
                ctx.stroke();

                // Arc between Staff and Crown
                ctx.beginPath();
                ctx.moveTo(staffBaseX, staffBaseY - 44);
                ctx.lineTo(wizX + 10, wizY - 38);
                ctx.lineTo(wizX + 4, crownY);
                ctx.stroke();
            }
            ctx.restore();
        }

        // ---------------------------------------------------------------------
        // Layer 8: Transcendent & Godlike Singularity Auras (Combo >= 150 & 200)
        // ---------------------------------------------------------------------
        // Ethereal Orbiting Lexicon: Foreground Leaves (Math.sin(angle) >= 0)
        if (numLeaves > 0) {
            for (let l = 0; l < numLeaves; l++) {
                const lAngle = (now * 0.0016 * leafSpeedMult) + (l * Math.PI * 2) / numLeaves;
                if (Math.sin(lAngle) >= 0) {
                    const lx = wizX + Math.cos(lAngle) * leafOrbitRx;
                    const ly = (wizY - 14) + Math.sin(lAngle) * leafOrbitRy;
                    CharacterRenderer._drawLexiconLeaf(ctx, lx, ly, lAngle, now, l, true, wandColor, lowQ);
                }
            }
        }

        if (combo >= 150) {
            ctx.save();
            const orbitRot = now * 0.002;
            const orbitCount = combo >= 200 ? 6 : 4;
            const orbitRadius = 38 + Math.sin(now / 180) * 4;

            // Orbiting Starlight Motes
            for (let o = 0; o < orbitCount; o++) {
                const angle = orbitRot + (o * Math.PI * 2) / orbitCount;
                const ox = wizX + Math.cos(angle) * orbitRadius;
                const oy = (wizY - 14) + Math.sin(angle) * (orbitRadius * 0.45); // Isometric elliptical orbit

                ctx.fillStyle = (o % 2 === 0) ? '#00e5ff' : '#ffd700';
                if (!lowQ) {
                    ctx.shadowColor = ctx.fillStyle;
                    ctx.shadowBlur = combo >= 200 ? 14 : 8;
                }
                ctx.beginPath();
                ctx.arc(ox, oy, combo >= 200 ? 3.0 : 2.0, 0, Math.PI * 2);
                ctx.fill();
            }

            // Combo >= 200: Godlike Singularity Radial Pulse
            if (combo >= 200) {
                const pulseR = 48 + ((now % 600) / 600) * 24;
                const pulseAlpha = Math.max(0, 1.0 - (now % 600) / 600) * 0.4;
                ctx.beginPath();
                ctx.ellipse(wizX, wizY - 14, pulseR, pulseR * 0.5, 0, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(255, 255, 255, ${pulseAlpha})`;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.restore();
        }

        ctx.restore();
    }

    /**
     * Renders an individual illuminated manuscript folio for the Ethereal Lexicon.
     */
    static _drawLexiconLeaf(ctx, lx, ly, angle, now, p, isForeground, wandColor, lowQ) {
        ctx.save();
        ctx.translate(lx, ly);
        const flutter = Math.sin(now / 140 + p * 1.5) * 0.2;
        ctx.rotate(angle + Math.PI / 2 + flutter);

        const scale = isForeground ? 1.0 : 0.78;
        ctx.scale(scale, scale);

        // Parchment Leaf Body (Ivory / Aged Gold with glowing edge)
        ctx.fillStyle = isForeground ? 'rgba(255, 252, 240, 0.92)' : 'rgba(235, 225, 200, 0.65)';
        if (!lowQ && isForeground) {
            ctx.shadowColor = wandColor;
            ctx.shadowBlur = 6;
        }
        ctx.fillRect(-3.5, -5.5, 7, 11);

        // Golden / Cyan illuminated border
        ctx.strokeStyle = isForeground ? '#ffd700' : 'rgba(255, 215, 0, 0.5)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-3.5, -5.5, 7, 11);

        // Inscribed Runic Script Lines
        ctx.fillStyle = 'rgba(100, 70, 30, 0.75)';
        ctx.fillRect(-2, -3.5, 4, 1);
        ctx.fillRect(-2, -1, 3.5, 1);
        ctx.fillRect(-2, 1.5, 4, 1);

        // Illuminated Capital Letter Spark at top
        ctx.fillStyle = wandColor;
        ctx.beginPath();
        ctx.arc(0, -4.2, 0.9, 0, Math.PI * 2);
        ctx.fill();

        // Stardust trail spark behind leaf
        if (isForeground) {
            ctx.fillStyle = '#ffd700';
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.arc(-2, 7, 1.0, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}

