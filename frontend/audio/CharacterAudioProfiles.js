import { CHARACTERS, normalizeCharacter } from '../../backend/Characters.js';
import { MAGE_CLASSES, DEFAULT_MAGE_CLASS, normalizeMageClassForCharacter, activeForClass } from '../../backend/MageClasses.js';

/**
 * CharacterAudioProfiles.js
 *
 * Canonical audio profile registry for all 12 valid (character, discipline) pairs.
 * Each profile defines:
 *   - typing: short (45-85ms) tactile keystroke synthesis with 3 subtle variants
 *   - sigil: expressive (180-450ms) sigil activation / cast sound matching ArenaSigils.js geometry
 */

function makeProfileKey(character, mageClass) {
    const charNorm = (character || 'wizard').toLowerCase();
    const classNorm = (mageClass || DEFAULT_MAGE_CLASS).toLowerCase();
    return `${charNorm}.${classNorm}`;
}

export const CHARACTER_AUDIO_PROFILES = {
    // =========================================================================
    // 1. GRAND CHRONO-ARCHMAGE (WIZARD) — Controlled Celestial Resonance
    // =========================================================================
    'wizard.novice': {
        key: 'wizard.novice',
        character: 'wizard',
        mageClass: 'Novice',
        family: 'wizard',
        skillId: 'arcane-surge',
        typingDuration: 0.055,
        renderTyping: (ctx, dest, variant, t) => {
            // Soft rounded crystalline tap with tiny celestial overtone
            const baseFreq = 1180 + variant * 35;
            const osc = ctx.createOscillator();
            const harm = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(baseFreq, t);
            osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, t + 0.05);

            harm.type = 'sine';
            harm.frequency.setValueAtTime(baseFreq * 2, t);
            harm.frequency.exponentialRampToValueAtTime(baseFreq * 1.4, t + 0.035);

            const harmGain = ctx.createGain();
            harmGain.gain.setValueAtTime(0.04, t);
            harmGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.13, t + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);

            osc.connect(gain);
            harm.connect(harmGain);
            harmGain.connect(gain);
            gain.connect(dest);

            osc.start(t);
            osc.stop(t + 0.06);
            harm.start(t);
            harm.stop(t + 0.04);
            return [osc, harm, gain, harmGain];
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t) => {
            // Arcane Surge: 4-point celestial fifth chord chime + harmonic swell
            const chord = [587.33, 880.0, 1318.5]; // D5, A5, E6
            const nodes = [];
            const master = ctx.createGain();
            master.gain.setValueAtTime(0.24 * gainScale, t);
            master.connect(dest);
            nodes.push(master);

            chord.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, t + i * 0.02);
                osc.frequency.exponentialRampToValueAtTime(freq * 1.02, t + 0.24);

                g.gain.setValueAtTime(0.0001, t + i * 0.02);
                g.gain.linearRampToValueAtTime(0.18 / (i + 1), t + i * 0.02 + 0.02);
                g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

                osc.connect(g);
                g.connect(master);
                osc.start(t + i * 0.02);
                osc.stop(t + 0.3);
                nodes.push(osc, g);
            });
            return nodes;
        }
    },

    'wizard.pyromancer': {
        key: 'wizard.pyromancer',
        character: 'wizard',
        mageClass: 'Pyromancer',
        family: 'wizard',
        skillId: 'cinder-brand',
        typingDuration: 0.060,
        renderTyping: (ctx, dest, variant, t, noiseBuf) => {
            // Warm ember tick with brief filtered crackle under gem attack
            const baseFreq = 960 + variant * 30;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(baseFreq, t);
            osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.66, t + 0.05);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.12, t + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.058);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.06);
            const nodes = [osc, gain];

            if (noiseBuf) {
                const noise = ctx.createBufferSource();
                noise.buffer = noiseBuf;
                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1800 + variant * 120, t);
                filter.Q.value = 3.0;

                const nGain = ctx.createGain();
                nGain.gain.setValueAtTime(0.035, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

                noise.connect(filter);
                filter.connect(nGain);
                nGain.connect(dest);
                noise.start(t);
                noise.stop(t + 0.04);
                nodes.push(noise, filter, nGain);
            }
            return nodes;
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t, noiseBuf) => {
            // Cinder Brand: Low-mid ignition flare + filtered ember crackle burst
            const osc = ctx.createOscillator();
            const oscGain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(220, t);
            osc.frequency.exponentialRampToValueAtTime(540, t + 0.08);
            osc.frequency.exponentialRampToValueAtTime(180, t + 0.28);

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(600, t);
            filter.frequency.exponentialRampToValueAtTime(1800, t + 0.08);
            filter.frequency.exponentialRampToValueAtTime(300, t + 0.3);

            oscGain.gain.setValueAtTime(0.0001, t);
            oscGain.gain.linearRampToValueAtTime(0.25 * gainScale, t + 0.03);
            oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

            osc.connect(filter);
            filter.connect(oscGain);
            oscGain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.34);
            const nodes = [osc, filter, oscGain];

            if (noiseBuf) {
                const noise = ctx.createBufferSource();
                noise.buffer = noiseBuf;
                const bpf = ctx.createBiquadFilter();
                bpf.type = 'bandpass';
                bpf.frequency.setValueAtTime(2200, t);
                bpf.Q.value = 2.0;

                const nGain = ctx.createGain();
                nGain.gain.setValueAtTime(0.08 * gainScale, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

                noise.connect(bpf);
                bpf.connect(nGain);
                nGain.connect(dest);
                noise.start(t);
                noise.stop(t + 0.24);
                nodes.push(noise, bpf, nGain);
            }
            return nodes;
        }
    },

    'wizard.cryomancer': {
        key: 'wizard.cryomancer',
        character: 'wizard',
        mageClass: 'Cryomancer',
        family: 'wizard',
        skillId: 'glacial-ward',
        typingDuration: 0.048,
        renderTyping: (ctx, dest, variant, t) => {
            // Damped ice/glass pin: brittle, crisp without piercing highs
            const baseFreq = 1480 + variant * 40;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(baseFreq, t);
            osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.75, t + 0.045);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.11, t + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.048);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.05);
            return [osc, gain];
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t) => {
            // Glacial Ward: High-Q crystalline hex lock + resonant glass shimmer
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();

            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(1567.98, t); // G6
            osc1.frequency.exponentialRampToValueAtTime(2093.0, t + 0.08); // C7

            osc2.type = 'triangle';
            osc2.frequency.setValueAtTime(3135.96, t);
            osc2.frequency.exponentialRampToValueAtTime(2637.02, t + 0.15); // E7

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.22 * gainScale, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(dest);

            osc1.start(t);
            osc1.stop(t + 0.3);
            osc2.start(t);
            osc2.stop(t + 0.25);
            return [osc1, osc2, gain];
        }
    },

    'wizard.chronomancer': {
        key: 'wizard.chronomancer',
        character: 'wizard',
        mageClass: 'Chronomancer',
        family: 'wizard',
        skillId: 'time-stop',
        typingDuration: 0.052,
        renderTyping: (ctx, dest, variant, t) => {
            // Muted timepiece tick with paired tonal gesture
            const osc1 = ctx.createOscillator();
            const g1 = ctx.createGain();
            osc1.type = 'triangle';
            osc1.frequency.setValueAtTime(1050 + variant * 30, t);
            osc1.frequency.exponentialRampToValueAtTime(680, t + 0.022);

            g1.gain.setValueAtTime(0.0001, t);
            g1.gain.linearRampToValueAtTime(0.12, t + 0.002);
            g1.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

            osc1.connect(g1);
            g1.connect(dest);
            osc1.start(t);
            osc1.stop(t + 0.03);

            // Paired clock echo tick
            const osc2 = ctx.createOscillator();
            const g2 = ctx.createGain();
            const tEcho = t + 0.022;
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(740, tEcho);
            osc2.frequency.exponentialRampToValueAtTime(420, tEcho + 0.025);

            g2.gain.setValueAtTime(0.0001, tEcho);
            g2.gain.linearRampToValueAtTime(0.06, tEcho + 0.002);
            g2.gain.exponentialRampToValueAtTime(0.001, tEcho + 0.028);

            osc2.connect(g2);
            g2.connect(dest);
            osc2.start(tEcho);
            osc2.stop(tEcho + 0.03);

            return [osc1, g1, osc2, g2];
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t) => {
            // Two-stage Chronomancer cue:
            // 1. request: crisp double-escapement clock tick
            // 2. activate / preview / arm: deep astrolabe bell + rapid decelerating clock sweep
            if (stage === 'request') {
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(1400, t);
                osc.frequency.exponentialRampToValueAtTime(800, t + 0.04);
                osc.frequency.setValueAtTime(1200, t + 0.05);
                osc.frequency.exponentialRampToValueAtTime(600, t + 0.09);

                g.gain.setValueAtTime(0.0001, t);
                g.gain.linearRampToValueAtTime(0.20 * gainScale, t + 0.005);
                g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

                osc.connect(g);
                g.connect(dest);
                osc.start(t);
                osc.stop(t + 0.13);
                return [osc, g];
            }

            // 'activate' (authoritative Time Stop lock):
            const bell = ctx.createOscillator();
            const bellGain = ctx.createGain();
            bell.type = 'sine';
            bell.frequency.setValueAtTime(440, t); // A4
            bell.frequency.exponentialRampToValueAtTime(435, t + 0.4);

            bellGain.gain.setValueAtTime(0.0001, t);
            bellGain.gain.linearRampToValueAtTime(0.35 * gainScale, t + 0.01);
            bellGain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);

            bell.connect(bellGain);
            bellGain.connect(dest);
            bell.start(t);
            bell.stop(t + 0.44);

            // Decelerating clockwork wind-down
            const sweep = ctx.createOscillator();
            const sweepGain = ctx.createGain();
            sweep.type = 'sawtooth';
            sweep.frequency.setValueAtTime(880, t);
            sweep.frequency.exponentialRampToValueAtTime(190, t + 0.35);

            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1200, t);
            filter.frequency.exponentialRampToValueAtTime(300, t + 0.35);

            sweepGain.gain.setValueAtTime(0.0001, t);
            sweepGain.gain.linearRampToValueAtTime(0.18 * gainScale, t + 0.02);
            sweepGain.gain.exponentialRampToValueAtTime(0.001, t + 0.38);

            sweep.connect(filter);
            filter.connect(sweepGain);
            sweepGain.connect(dest);
            sweep.start(t);
            sweep.stop(t + 0.4);

            return [bell, bellGain, sweep, filter, sweepGain];
        }
    },

    // =========================================================================
    // 2. VOIDWEAVER — Inward Pressure & Absence
    // =========================================================================
    'voidweaver.novice': {
        key: 'voidweaver.novice',
        character: 'voidweaver',
        mageClass: 'Novice',
        family: 'voidweaver',
        skillId: 'arcane-surge',
        typingDuration: 0.065,
        renderTyping: (ctx, dest, variant, t) => {
            // Hollow inward pulse with faint bent-light overtone
            const baseFreq = 680 + variant * 25;
            const osc = ctx.createOscillator();
            const overtone = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(baseFreq, t);
            osc.frequency.exponentialRampToValueAtTime(310, t + 0.06);

            overtone.type = 'triangle';
            overtone.frequency.setValueAtTime(baseFreq * 1.5, t);
            overtone.frequency.exponentialRampToValueAtTime(450, t + 0.04);

            const ovGain = ctx.createGain();
            ovGain.gain.setValueAtTime(0.035, t);
            ovGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.14, t + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.065);

            osc.connect(gain);
            overtone.connect(ovGain);
            ovGain.connect(gain);
            gain.connect(dest);

            osc.start(t);
            osc.stop(t + 0.07);
            overtone.start(t);
            overtone.stop(t + 0.05);
            return [osc, overtone, gain, ovGain];
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t) => {
            // Void Surge: 4-arm inward pitch spiral into dark core hum
            const osc = ctx.createOscillator();
            const filter = ctx.createBiquadFilter();
            const gain = ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(740, t);
            osc.frequency.exponentialRampToValueAtTime(140, t + 0.28);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(1200, t);
            filter.frequency.exponentialRampToValueAtTime(220, t + 0.3);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.24 * gainScale, t + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.34);
            return [osc, filter, gain];
        }
    },

    'voidweaver.singulist': {
        key: 'voidweaver.singulist',
        character: 'voidweaver',
        mageClass: 'Singulist',
        family: 'voidweaver',
        skillId: 'crushing-gravity',
        typingDuration: 0.058,
        renderTyping: (ctx, dest, variant, t) => {
            // Compressed descending gravity knock (short and punchy, not an explosion)
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(520 + variant * 20, t);
            osc.frequency.exponentialRampToValueAtTime(135, t + 0.055);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.18, t + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.058);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.06);
            return [osc, gain];
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t) => {
            // Crushing Gravity: 3 stepped inward compressions + dense sub-core drop
            const sub = ctx.createOscillator();
            const subGain = ctx.createGain();
            sub.type = 'sine';
            sub.frequency.setValueAtTime(180, t);
            sub.frequency.exponentialRampToValueAtTime(48, t + 0.32);

            subGain.gain.setValueAtTime(0.0001, t);
            subGain.gain.linearRampToValueAtTime(0.32 * gainScale, t + 0.03);
            subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);

            sub.connect(subGain);
            subGain.connect(dest);
            sub.start(t);
            sub.stop(t + 0.36);

            // High tension snap
            const snap = ctx.createOscillator();
            const snapGain = ctx.createGain();
            snap.type = 'triangle';
            snap.frequency.setValueAtTime(660, t);
            snap.frequency.exponentialRampToValueAtTime(220, t + 0.12);
            snapGain.gain.setValueAtTime(0.15 * gainScale, t);
            snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

            snap.connect(snapGain);
            snapGain.connect(dest);
            snap.start(t);
            snap.stop(t + 0.14);

            return [sub, subGain, snap, snapGain];
        }
    },

    'voidweaver.nullwarden': {
        key: 'voidweaver.nullwarden',
        character: 'voidweaver',
        mageClass: 'Nullwarden',
        family: 'voidweaver',
        skillId: 'event-horizon',
        typingDuration: 0.048,
        renderTyping: (ctx, dest, variant, t) => {
            // Muted resonant seal tap with an unusually short, abruptly damped tail
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(460 + variant * 20, t);
            osc.frequency.exponentialRampToValueAtTime(260, t + 0.042);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.13, t + 0.002);
            // Abrupt gate at 48ms
            gain.gain.setValueAtTime(0.04, t + 0.042);
            gain.gain.linearRampToValueAtTime(0.0001, t + 0.048);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.05);
            return [osc, gain];
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t) => {
            // Event Horizon: Heavy double-ring barrier thud whose tail is choked to dead silence
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(320, t);
            osc.frequency.exponentialRampToValueAtTime(95, t + 0.18);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.26 * gainScale, t + 0.02);
            // Sudden choke into silence
            gain.gain.setValueAtTime(0.08 * gainScale, t + 0.17);
            gain.gain.linearRampToValueAtTime(0.0001, t + 0.19);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.20);
            return [osc, gain];
        }
    },

    'voidweaver.riftbinder': {
        key: 'voidweaver.riftbinder',
        character: 'voidweaver',
        mageClass: 'Riftbinder',
        family: 'voidweaver',
        skillId: 'rift-tether',
        typingDuration: 0.055,
        renderTyping: (ctx, dest, variant, t, noiseBuf) => {
            // Soft tension pluck with a tiny airy tear
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(620 + variant * 30, t);
            osc.frequency.exponentialRampToValueAtTime(480, t + 0.05);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.12, t + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.054);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.056);
            const nodes = [osc, gain];

            if (noiseBuf) {
                const noise = ctx.createBufferSource();
                noise.buffer = noiseBuf;
                const hpf = ctx.createBiquadFilter();
                hpf.type = 'highpass';
                hpf.frequency.setValueAtTime(3200, t);

                const nGain = ctx.createGain();
                nGain.gain.setValueAtTime(0.03, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

                noise.connect(hpf);
                hpf.connect(nGain);
                nGain.connect(dest);
                noise.start(t);
                noise.stop(t + 0.03);
                nodes.push(noise, hpf, nGain);
            }
            return nodes;
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t, noiseBuf) => {
            // Rift Tether: Taut wire string pluck + airy bandpass slit tear
            const pluck = ctx.createOscillator();
            const pluckGain = ctx.createGain();
            pluck.type = 'sawtooth';
            pluck.frequency.setValueAtTime(330, t);
            pluck.frequency.exponentialRampToValueAtTime(660, t + 0.06);
            pluck.frequency.exponentialRampToValueAtTime(220, t + 0.28);

            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(1400, t);
            filter.Q.value = 3.0;

            pluckGain.gain.setValueAtTime(0.0001, t);
            pluckGain.gain.linearRampToValueAtTime(0.24 * gainScale, t + 0.015);
            pluckGain.gain.exponentialRampToValueAtTime(0.001, t + 0.30);

            pluck.connect(filter);
            filter.connect(pluckGain);
            pluckGain.connect(dest);
            pluck.start(t);
            pluck.stop(t + 0.32);
            const nodes = [pluck, filter, pluckGain];

            if (noiseBuf) {
                const noise = ctx.createBufferSource();
                noise.buffer = noiseBuf;
                const bpf = ctx.createBiquadFilter();
                bpf.type = 'bandpass';
                bpf.frequency.setValueAtTime(2800, t);
                bpf.Q.value = 4.0;

                const nGain = ctx.createGain();
                nGain.gain.setValueAtTime(0.06 * gainScale, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

                noise.connect(bpf);
                bpf.connect(nGain);
                nGain.connect(dest);
                noise.start(t);
                noise.stop(t + 0.26);
                nodes.push(noise, bpf, nGain);
            }
            return nodes;
        }
    },

    // =========================================================================
    // 3. BLOODSEEKER — Restrained Ritual Metal & Life Flow
    // =========================================================================
    'bloodseeker.novice': {
        key: 'bloodseeker.novice',
        character: 'bloodseeker',
        mageClass: 'Novice',
        family: 'bloodseeker',
        skillId: 'arcane-surge',
        typingDuration: 0.056,
        renderTyping: (ctx, dest, variant, t) => {
            // Restrained dark-metal/rune tap with subtle organic body
            const osc = ctx.createOscillator();
            const ring = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(840 + variant * 30, t);
            osc.frequency.exponentialRampToValueAtTime(520, t + 0.05);

            ring.type = 'sine';
            ring.frequency.setValueAtTime(1260 + variant * 40, t);
            ring.frequency.exponentialRampToValueAtTime(840, t + 0.035);

            const ringGain = ctx.createGain();
            ringGain.gain.setValueAtTime(0.05, t);
            ringGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.13, t + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.056);

            osc.connect(gain);
            ring.connect(ringGain);
            ringGain.connect(gain);
            gain.connect(dest);

            osc.start(t);
            osc.stop(t + 0.06);
            ring.start(t);
            ring.stop(t + 0.04);
            return [osc, ring, gain, ringGain];
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t) => {
            // Crimson Droplet Surge: Dark steel rune ring + rising harmonic droplet swell
            const ring = ctx.createOscillator();
            const ringGain = ctx.createGain();
            ring.type = 'triangle';
            ring.frequency.setValueAtTime(520, t);
            ring.frequency.exponentialRampToValueAtTime(480, t + 0.25);

            ringGain.gain.setValueAtTime(0.0001, t);
            ringGain.gain.linearRampToValueAtTime(0.20 * gainScale, t + 0.02);
            ringGain.gain.exponentialRampToValueAtTime(0.001, t + 0.27);

            ring.connect(ringGain);
            ringGain.connect(dest);
            ring.start(t);
            ring.stop(t + 0.28);

            // Rising droplet gesture
            const drop = ctx.createOscillator();
            const dropGain = ctx.createGain();
            drop.type = 'sine';
            drop.frequency.setValueAtTime(280, t + 0.03);
            drop.frequency.exponentialRampToValueAtTime(620, t + 0.22);

            dropGain.gain.setValueAtTime(0.0001, t + 0.03);
            dropGain.gain.linearRampToValueAtTime(0.18 * gainScale, t + 0.06);
            dropGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

            drop.connect(dropGain);
            dropGain.connect(dest);
            drop.start(t + 0.03);
            drop.stop(t + 0.26);

            return [ring, ringGain, drop, dropGain];
        }
    },

    'bloodseeker.hemomancer': {
        key: 'bloodseeker.hemomancer',
        character: 'bloodseeker',
        mageClass: 'Hemomancer',
        family: 'bloodseeker',
        skillId: 'blood-pact',
        typingDuration: 0.068,
        renderTyping: (ctx, dest, variant, t) => {
            // Rounded rising pulse with faint liquid-like resonance (not gore)
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(340 + variant * 15, t);
            osc.frequency.exponentialRampToValueAtTime(510, t + 0.065);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.14, t + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.068);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.07);
            return [osc, gain];
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t) => {
            // Blood Pact: Deep vitality pulse + 3 rising life-mote harmonics
            const osc = ctx.createOscillator();
            const oscGain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(180, t);
            osc.frequency.exponentialRampToValueAtTime(360, t + 0.28);

            oscGain.gain.setValueAtTime(0.0001, t);
            oscGain.gain.linearRampToValueAtTime(0.25 * gainScale, t + 0.03);
            oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.32);

            osc.connect(oscGain);
            oscGain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.34);

            // Harmonic triad
            const notes = [440, 554.37, 659.25]; // A4, C#5, E5
            const chordNodes = [];
            notes.forEach((freq, idx) => {
                const harm = ctx.createOscillator();
                const hGain = ctx.createGain();
                harm.type = 'triangle';
                harm.frequency.setValueAtTime(freq, t + idx * 0.03);

                hGain.gain.setValueAtTime(0.0001, t + idx * 0.03);
                hGain.gain.linearRampToValueAtTime(0.08 * gainScale, t + idx * 0.03 + 0.02);
                hGain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

                harm.connect(hGain);
                hGain.connect(dest);
                harm.start(t + idx * 0.03);
                harm.stop(t + 0.3);
                chordNodes.push(harm, hGain);
            });

            return [osc, oscGain, ...chordNodes];
        }
    },

    'bloodseeker.reaper': {
        key: 'bloodseeker.reaper',
        character: 'bloodseeker',
        mageClass: 'Reaper',
        family: 'bloodseeker',
        skillId: 'final-cut',
        typingDuration: 0.048,
        renderTyping: (ctx, dest, variant, t) => {
            // Dry, precise metal notch with clipped dark tail (matches reticle sight; no gunshot)
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1320 + variant * 40, t);
            osc.frequency.exponentialRampToValueAtTime(740, t + 0.045);

            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.linearRampToValueAtTime(0.14, t + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.048);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t);
            osc.stop(t + 0.05);
            return [osc, gain];
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t) => {
            // Final Cut: Cold, surgical metallic sight lock-on click + taut blade ring
            const click = ctx.createOscillator();
            const clickGain = ctx.createGain();
            click.type = 'square';
            click.frequency.setValueAtTime(1600, t);
            click.frequency.exponentialRampToValueAtTime(400, t + 0.03);

            clickGain.gain.setValueAtTime(0.0001, t);
            clickGain.gain.linearRampToValueAtTime(0.18 * gainScale, t + 0.003);
            clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

            click.connect(clickGain);
            clickGain.connect(dest);
            click.start(t);
            click.stop(t + 0.05);

            // Cold blade ring
            const blade = ctx.createOscillator();
            const bladeGain = ctx.createGain();
            blade.type = 'sine';
            blade.frequency.setValueAtTime(880, t + 0.02);
            blade.frequency.exponentialRampToValueAtTime(840, t + 0.25);

            bladeGain.gain.setValueAtTime(0.0001, t + 0.02);
            bladeGain.gain.linearRampToValueAtTime(0.20 * gainScale, t + 0.035);
            bladeGain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);

            blade.connect(bladeGain);
            bladeGain.connect(dest);
            blade.start(t + 0.02);
            blade.stop(t + 0.28);

            return [click, clickGain, blade, bladeGain];
        }
    },

    'bloodseeker.bloodruner': {
        key: 'bloodseeker.bloodruner',
        character: 'bloodseeker',
        mageClass: 'Bloodruner',
        family: 'bloodseeker',
        skillId: 'bloodletting',
        typingDuration: 0.064,
        renderTyping: (ctx, dest, variant, t, noiseBuf) => {
            // Short etched scrape followed by descending ritual pulse
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(480 + variant * 20, t + 0.015);
            osc.frequency.exponentialRampToValueAtTime(240, t + 0.06);

            gain.gain.setValueAtTime(0.0001, t + 0.015);
            gain.gain.linearRampToValueAtTime(0.12, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.064);

            osc.connect(gain);
            gain.connect(dest);
            osc.start(t + 0.015);
            osc.stop(t + 0.068);
            const nodes = [osc, gain];

            if (noiseBuf) {
                const noise = ctx.createBufferSource();
                noise.buffer = noiseBuf;
                const bpf = ctx.createBiquadFilter();
                bpf.type = 'bandpass';
                bpf.frequency.setValueAtTime(2200, t);
                bpf.Q.value = 3.0;

                const nGain = ctx.createGain();
                nGain.gain.setValueAtTime(0.04, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.022);

                noise.connect(bpf);
                bpf.connect(nGain);
                nGain.connect(dest);
                noise.start(t);
                noise.stop(t + 0.024);
                nodes.push(noise, bpf, nGain);
            }
            return nodes;
        },
        renderSigil: (ctx, dest, { stage = 'arm', gainScale = 1.0 } = {}, t, noiseBuf) => {
            // Bloodletting Incision: Cross-cut blade etch scrape + descending crimson drain resonance
            const nodes = [];
            if (noiseBuf) {
                const noise = ctx.createBufferSource();
                noise.buffer = noiseBuf;
                const bpf = ctx.createBiquadFilter();
                bpf.type = 'bandpass';
                bpf.frequency.setValueAtTime(2600, t);
                bpf.Q.value = 2.5;

                const nGain = ctx.createGain();
                nGain.gain.setValueAtTime(0.09 * gainScale, t);
                nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

                noise.connect(bpf);
                bpf.connect(nGain);
                nGain.connect(dest);
                noise.start(t);
                noise.stop(t + 0.08);
                nodes.push(noise, bpf, nGain);
            }

            // Descending incision drain resonance
            const drain = ctx.createOscillator();
            const drainGain = ctx.createGain();
            drain.type = 'sine';
            drain.frequency.setValueAtTime(540, t + 0.04);
            drain.frequency.exponentialRampToValueAtTime(220, t + 0.30);

            drainGain.gain.setValueAtTime(0.0001, t + 0.04);
            drainGain.gain.linearRampToValueAtTime(0.22 * gainScale, t + 0.08);
            drainGain.gain.exponentialRampToValueAtTime(0.001, t + 0.33);

            drain.connect(drainGain);
            drainGain.connect(dest);
            drain.start(t + 0.04);
            drain.stop(t + 0.35);
            nodes.push(drain, drainGain);

            return nodes;
        }
    }
};

/**
 * Resolves a (character, mageClass) pair to a canonical audio profile.
 * Guarantees that any invalid or cross-character combination falls back to
 * THAT CHARACTER'S own Novice profile, never leaking another character's sound.
 */
export function resolveCharacterAudioProfile(character, mageClass) {
    const charId = normalizeCharacter(character);
    const clsId = normalizeMageClassForCharacter(mageClass, charId);
    const key = makeProfileKey(charId, clsId);
    const profile = CHARACTER_AUDIO_PROFILES[key];
    if (profile) return profile;

    // Fallback to character's novice
    const fallbackKey = `${charId}.novice`;
    return CHARACTER_AUDIO_PROFILES[fallbackKey] || CHARACTER_AUDIO_PROFILES['wizard.novice'];
}

/**
 * Resolves an Arena skillId + character to its exact sigil audio profile.
 * Only 'arcane-surge' is character-scoped (3 Novice variants);
 * all other 9 active skills belong to exactly one character and class.
 */
export function resolveSigilAudioProfile(skillId, character = 'wizard') {
    const charId = normalizeCharacter(character);
    if (skillId === 'arcane-surge') {
        return resolveCharacterAudioProfile(charId, 'Novice');
    }
    for (const key of Object.keys(CHARACTER_AUDIO_PROFILES)) {
        const p = CHARACTER_AUDIO_PROFILES[key];
        if (p.skillId === skillId) {
            return p;
        }
    }
    // Fallback to character's novice
    return resolveCharacterAudioProfile(charId, 'Novice');
}

/**
 * Lists all 12 valid (character, discipline) pairs derived from the canonical rosters.
 */
export function listAllValidAudioPairs() {
    return Object.keys(CHARACTER_AUDIO_PROFILES).map((key) => {
        const p = CHARACTER_AUDIO_PROFILES[key];
        return {
            key,
            character: p.character,
            mageClass: p.mageClass,
            skillId: p.skillId,
            family: p.family
        };
    });
}
