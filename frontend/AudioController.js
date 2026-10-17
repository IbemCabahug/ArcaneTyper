import { resolveCharacterAudioProfile, resolveSigilAudioProfile } from './audio/CharacterAudioProfiles.js';

export class AudioController {
    constructor(ctx = null) {
        if (ctx) {
            this.ctx = ctx;
        } else if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } else {
            this.ctx = null;
        }

        this.bgOscillator1 = null;
        this.bgOscillator2 = null;
        this.bgFilter = null;
        this.bgGain = null;
        this.bgLfo = null;
        this.bgLfoGain = null;

        // Tension Arpeggiator
        this.tensionOsc = null;
        this.tensionGain = null;
        this.tensionLfo = null;
        this.tremoloGain = null;
        this.isPlayingBg = false;

        // Master volume & Mute (AT-F3 with localStorage persistence and robust NaN guard)
        let savedVolume = null;
        let savedMuted = null;
        try {
            if (typeof localStorage !== 'undefined') {
                savedVolume = localStorage.getItem('typerMaster_volume');
                savedMuted = localStorage.getItem('typerMaster_muted');
            }
        } catch (_) {}
        const parsedVol = savedVolume !== null ? parseFloat(savedVolume) : 0.5;
        this._volume = Number.isFinite(parsedVol) ? Math.max(0, Math.min(1, parsedVol)) : 0.5;
        this._isMuted = savedMuted === 'true';

        if (this.ctx) {
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this._isMuted ? 0 : this._volume;
            if (this.ctx.destination) {
                this.masterGain.connect(this.ctx.destination);
            }

            // Internal SFX Bus (all keystrokes, sigil cues, explosions, and UI clicks route here)
            this.sfxGain = this.ctx.createGain();
            this.sfxGain.connect(this.masterGain);
        } else {
            this.masterGain = null;
            this.sfxGain = null;
        }

        // Voice Limiting & Pre-baked AudioBuffer Caching (CHARACTER-AUDIO-RESEARCH)
        this._maxTypingVoices = 6;
        this._maxTransientVoices = 12;
        this._activeTypingVoices = [];
        this._activeTransientVoices = [];
        this._profileBufferCache = new Map();
        this._lastVariantByProfile = new Map();
        this._prepareGeneration = 0;
        this._sharedNoiseBuffer = null;

        // Intensity state
        this.currentIntensity = 0; // 0.0 to 1.0 based on combo
    }

    _canPlaySfx() {
        return Boolean(this.ctx && !this._isMuted && this._volume > 0);
    }

    _resumeContext() {
        if (this.ctx && this.ctx.state === 'suspended') {
            try {
                const p = this.ctx.resume();
                if (p && typeof p.catch === 'function') {
                    p.catch(() => {});
                }
            } catch (_) {}
        }
    }

    _getSharedNoiseBuffer() {
        if (this._sharedNoiseBuffer) return this._sharedNoiseBuffer;
        if (!this.ctx) return null;
        try {
            const sampleRate = this.ctx.sampleRate || 44100;
            const bufferSize = Math.floor(sampleRate * 0.5);
            const buffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            this._sharedNoiseBuffer = buffer;
            return buffer;
        } catch (_) {
            return null;
        }
    }

    _registerTypingVoice(sourceNode, gainNode) {
        if (!sourceNode) return;
        // Strict cap of 6 concurrent typing voices (CHARACTER-AUDIO-RESEARCH)
        while (this._activeTypingVoices.length >= this._maxTypingVoices) {
            const oldest = this._activeTypingVoices.shift();
            if (oldest && oldest.gainNode) {
                try {
                    const now = this.ctx.currentTime;
                    oldest.gainNode.gain.cancelScheduledValues(now);
                    oldest.gainNode.gain.setValueAtTime(oldest.gainNode.gain.value, now);
                    oldest.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.008);
                    setTimeout(() => {
                        try {
                            oldest.sourceNode.stop();
                            oldest.sourceNode.disconnect();
                            oldest.gainNode.disconnect();
                        } catch (_) {}
                    }, 10);
                } catch (_) {}
            }
        }

        const voiceEntry = { sourceNode, gainNode };
        this._activeTypingVoices.push(voiceEntry);

        sourceNode.onended = () => {
            const idx = this._activeTypingVoices.indexOf(voiceEntry);
            if (idx !== -1) this._activeTypingVoices.splice(idx, 1);
            try { sourceNode.disconnect(); } catch (_) {}
            try { gainNode.disconnect(); } catch (_) {}
        };
    }

    _registerTransientVoice(sourceNode, gainNode) {
        if (!sourceNode) return;
        while (this._activeTransientVoices.length >= this._maxTransientVoices) {
            const oldest = this._activeTransientVoices.shift();
            if (oldest && oldest.gainNode) {
                try {
                    const now = this.ctx.currentTime;
                    oldest.gainNode.gain.cancelScheduledValues(now);
                    oldest.gainNode.gain.linearRampToValueAtTime(0.0001, now + 0.01);
                    setTimeout(() => {
                        try {
                            oldest.sourceNode.stop();
                            oldest.sourceNode.disconnect();
                            oldest.gainNode.disconnect();
                        } catch (_) {}
                    }, 12);
                } catch (_) {}
            }
        }

        const entry = { sourceNode, gainNode };
        this._activeTransientVoices.push(entry);

        sourceNode.onended = () => {
            const idx = this._activeTransientVoices.indexOf(entry);
            if (idx !== -1) this._activeTransientVoices.splice(idx, 1);
            try { sourceNode.disconnect(); } catch (_) {}
            try { gainNode.disconnect(); } catch (_) {}
        };
    }

    stopAllTransientVoices() {
        for (const v of [...this._activeTypingVoices, ...this._activeTransientVoices]) {
            try {
                if (v.sourceNode) {
                    v.sourceNode.stop();
                    v.sourceNode.disconnect();
                }
                if (v.gainNode) {
                    v.gainNode.disconnect();
                }
            } catch (_) {}
        }
        this._activeTypingVoices = [];
        this._activeTransientVoices = [];
    }

    /**
     * Attaches an onended cleanup handler to transient Web Audio nodes to prevent
     * memory leaks in the browser's audio graph.
     */
    _attachCleanup(sourceNode, ...connectedNodes) {
        if (!sourceNode) return;
        sourceNode.onended = () => {
            try {
                sourceNode.disconnect();
            } catch (_) {}
            for (const node of connectedNodes) {
                if (node && typeof node.disconnect === 'function') {
                    try {
                        node.disconnect();
                    } catch (_) {}
                }
            }
        };
    }

    // --- Master Volume & Mute API (AT-F3) ---
    setMasterVolume(val) {
        this._volume = Math.max(0, Math.min(1, val));
        try {
            localStorage.setItem('typerMaster_volume', String(this._volume));
        } catch (_) {}
        if (!this._isMuted) {
            this.masterGain.gain.setValueAtTime(this._volume, this.ctx.currentTime);
        }
    }

    getMasterVolume() {
        return this._volume;
    }

    toggleMute() {
        this._isMuted = !this._isMuted;
        try {
            localStorage.setItem('typerMaster_muted', String(this._isMuted));
        } catch (_) {}
        const target = this._isMuted ? 0 : this._volume;
        this.masterGain.gain.setValueAtTime(target, this.ctx.currentTime);
        if (this._isMuted) {
            this.stopAllTransientVoices();
        }
        return this._isMuted;
    }

    isMuted() {
        return this._isMuted;
    }

    setCharacterAudioProfile(character, mageClass) {
        const profile = resolveCharacterAudioProfile(character, mageClass);
        if (!profile) return null;
        this._activeProfileKey = profile.key;
        this.prepareCharacterProfile(character, mageClass).catch(() => {});
        return profile;
    }

    /**
     * Pre-bakes 3 variants of the typing profile into AudioBuffers via OfflineAudioContext.
     * Guarantees zero runtime synthesis overhead and zero per-keystroke garbage collection.
     */
    async prepareCharacterProfile(character, mageClass) {
        const profile = resolveCharacterAudioProfile(character, mageClass);
        if (!profile) return null;

        // Increment generation token BEFORE checking the cache so switching back to an
        // already-cached profile still invalidates any slower in-flight OfflineAudioContext render.
        const token = ++this._prepareGeneration;
        this._activeProfileKey = profile.key;

        if (this._profileBufferCache.has(profile.key)) {
            return this._profileBufferCache.get(profile.key);
        }

        const OfflineContextClass = this._offlineContextClass
            || (typeof window !== 'undefined' && (window.OfflineAudioContext || window.webkitOfflineAudioContext))
            || null;
        if (!OfflineContextClass) return null;

        const sampleRate = this.ctx?.sampleRate || 44100;
        const duration = profile.typingDuration || 0.06;
        const length = Math.ceil(sampleRate * (duration + 0.02));
        const noiseBuf = this._getSharedNoiseBuffer();
        const bakedVariants = [];

        try {
            for (let v = 0; v < 3; v++) {
                const offCtx = new OfflineContextClass(1, length, sampleRate);
                profile.renderTyping(offCtx, offCtx.destination, v, 0, noiseBuf);
                const rendered = await offCtx.startRendering();
                bakedVariants.push(rendered);
            }
            if (this._prepareGeneration === token) {
                this._profileBufferCache.set(profile.key, bakedVariants);
                this._activeProfileKey = profile.key;
            }
            return bakedVariants;
        } catch (e) {
            console.warn('[AudioController] OfflineAudioContext baking skipped:', e);
            return null;
        }
    }

    playUiClick() {
        if (!this._canPlaySfx()) return;
        this._resumeContext();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Short, crisp high-pitched neutral UI tick
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, t);
        osc.frequency.exponentialRampToValueAtTime(800, t + 0.05);

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.12, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

        osc.connect(gain);
        gain.connect(this.sfxGain);

        this._registerTransientVoice(osc, gain);
        osc.start(t);
        osc.stop(t + 0.06);
    }

    playTypeSound(character = 'wizard', mageClass = 'Novice') {
        if (!this._canPlaySfx()) return;
        this._resumeContext();

        const profile = resolveCharacterAudioProfile(character, mageClass);
        const cached = this._profileBufferCache.get(profile.key);

        if (cached && cached.length > 0) {
            // Pick next non-repeating variant
            const prev = this._lastVariantByProfile.get(profile.key) ?? -1;
            const offset = 1 + Math.floor(Math.random() * (cached.length - 1));
            const variantIdx = prev < 0 ? Math.floor(Math.random() * cached.length) : (prev + offset) % cached.length;
            this._lastVariantByProfile.set(profile.key, variantIdx);

            const buffer = cached[variantIdx];
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;

            // Micro pitch variation: +/- 1.2%
            source.playbackRate.value = 1.0 + (Math.random() - 0.5) * 0.024;

            const voiceGain = this.ctx.createGain();
            // Micro gain variation: +/- 4%
            const gainJitter = 1.0 + (Math.random() - 0.5) * 0.08;
            voiceGain.gain.setValueAtTime(gainJitter, this.ctx.currentTime);

            source.connect(voiceGain);
            voiceGain.connect(this.sfxGain);

            this._registerTypingVoice(source, voiceGain);
            source.start(this.ctx.currentTime);
            return;
        }

        // Procedural fallback: execute the profile's recipe directly on this.ctx
        const t = this.ctx.currentTime;
        const voiceGain = this.ctx.createGain();
        voiceGain.connect(this.sfxGain);

        const prev = this._lastVariantByProfile.get(profile.key) ?? -1;
        const variantIdx = (prev + 1) % 3;
        this._lastVariantByProfile.set(profile.key, variantIdx);

        const nodes = profile.renderTyping(this.ctx, voiceGain, variantIdx, t, this._getSharedNoiseBuffer());
        if (nodes && nodes.length > 0) {
            const primarySource = nodes.find(n => n && typeof n.start === 'function' && typeof n.stop === 'function') || nodes[0];
            this._registerTypingVoice(primarySource, voiceGain);
        }

        // Trigger background pre-bake for upcoming keystrokes
        if (!this._profileBufferCache.has(profile.key)) {
            this.prepareCharacterProfile(character, mageClass).catch(() => {});
        }
    }

    playSigilSound(skillId, character = 'wizard', { stage = 'arm', gainScale = 1.0 } = {}) {
        if (!this._canPlaySfx()) return;
        this._resumeContext();

        const profile = resolveSigilAudioProfile(skillId, character);
        if (!profile || typeof profile.renderSigil !== 'function') {
            this.playMagicSpark();
            return;
        }

        const t = this.ctx.currentTime;
        const sigilGain = this.ctx.createGain();
        sigilGain.connect(this.sfxGain);

        const nodes = profile.renderSigil(this.ctx, sigilGain, { stage, gainScale }, t, this._getSharedNoiseBuffer());
        if (nodes && nodes.length > 0) {
            const primarySource = nodes.find(n => n && typeof n.start === 'function' && typeof n.stop === 'function') || nodes[0];
            this._registerTransientVoice(primarySource, sigilGain);
        }
    }

    playMagicSpark() {
        if (!this._canPlaySfx()) return;
        this._resumeContext();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(1200, t + 0.1); // High pitch slide up

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

        osc.connect(gain);
        gain.connect(this.sfxGain);

        this._registerTransientVoice(osc, gain);
        osc.start(t);
        osc.stop(t + 0.2);
    }

    playErrorSound() {
        if (!this._canPlaySfx()) return;
        this._resumeContext();
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Low "buzz"
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, t);
        osc.frequency.linearRampToValueAtTime(90, t + 0.1);

        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);

        osc.connect(gain);
        gain.connect(this.sfxGain);

        this._registerTransientVoice(osc, gain);
        osc.start(t);
        osc.stop(t + 0.2);
    }

    playLevelUp() {
        if (!this._canPlaySfx()) return;
        this._resumeContext();
        const t = this.ctx.currentTime;

        // Fast Arpeggio (C major vi)
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

        notes.forEach((freq, index) => {
            const noteTime = t + index * 0.1;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, noteTime);

            gain.gain.setValueAtTime(0.0001, noteTime);
            gain.gain.linearRampToValueAtTime(0.2, noteTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.01, noteTime + 0.3);

            osc.connect(gain);
            gain.connect(this.sfxGain);

            this._registerTransientVoice(osc, gain);
            osc.start(noteTime);
            osc.stop(noteTime + 0.4);
        });
    }

    playComboSound(combo) {
        if (!this._canPlaySfx()) return;
        this._resumeContext();
        const t = this.ctx.currentTime;

        // Define melodies based on combo tier (10 = low, 50 = epic)
        let rootFreq = 440; // A4
        let notes = [];

        // All tiers use pure 'sine' waves to simulate a magical harp chime glissando
        let noteInterval = 0.1;
        if (combo >= 200) {
            rootFreq = 1046.5; // C6 - Transcendent / Godlike Singularity
            notes = [1, 1.25, 1.5, 1.875, 2.0, 2.25, 2.5]; // 7-note celestial octave cascade
            noteInterval = 0.06;
        } else if (combo >= 150) {
            rootFreq = 987.77; // B5 - Transcendent
            notes = [1, 1.25, 1.5, 1.75, 2.0, 2.25]; // 6-note shimmering overtone
            noteInterval = 0.07;
        } else if (combo >= 100) {
            rootFreq = 880; // A5 - Celestial
            notes = [1, 1.25, 1.5, 1.75, 2.0]; // Celestial double-octave chime
            noteInterval = 0.08;
        } else if (combo >= 75) {
            rootFreq = 783.99; // G5 - Mythic
            notes = [1, 1.25, 1.5, 1.666, 2.0]; // Radiant pentatonic sweep
            noteInterval = 0.09;
        } else if (combo >= 50) {
            rootFreq = 880; // A5
            notes = [1, 1.25, 1.5, 1.666, 2.0]; // Ethereal 5-note sweep (Major pentatonic)
        } else if (combo >= 40) {
            rootFreq = 659.25; // E5
            notes = [1, 1.25, 1.5, 2.0]; // Major chord sweep
        } else if (combo >= 30) {
            rootFreq = 523.25; // C5
            notes = [1, 1.25, 1.5]; // Major triad
        } else if (combo >= 20) {
            rootFreq = 440; // A4
            notes = [1, 1.2]; // Minor third (A4 -> C5)
        } else if (combo >= 10) {
            rootFreq = 329.63; // E4
            notes = [1]; // Single smooth chime
        } else {
            return;
        }

        notes.forEach((ratio, index) => {
            const noteTime = t + index * noteInterval;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(rootFreq * ratio, noteTime);

            // Envelope: fast attack, long smooth decay (bell-like)
            gain.gain.setValueAtTime(0.0001, noteTime);
            gain.gain.linearRampToValueAtTime(0.4, noteTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.01, noteTime + 0.6);

            osc.connect(gain);
            gain.connect(this.sfxGain);

            this._registerTransientVoice(osc, gain);
            osc.start(noteTime);
            osc.stop(noteTime + 1.0);
        });
    }

    playExplosion() {
        if (!this._canPlaySfx()) return;
        this._resumeContext();
        const t = this.ctx.currentTime;

        // Low frequency thud
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.5);

        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.5);

        // Filter it to make it sound muffled/bassy
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(800, t);
        filter.frequency.exponentialRampToValueAtTime(100, t + 0.5);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);

        this._registerTransientVoice(osc, gain);
        this._attachCleanup(osc, filter);
        osc.start(t);
        osc.stop(t + 0.6);
    }

    playShatter() {
        if (!this._canPlaySfx()) return;
        this._resumeContext();
        const t = this.ctx.currentTime;
        const duration = 0.3;

        const noiseBuf = this._getSharedNoiseBuffer();
        if (!noiseBuf) return;

        const noise = this.ctx.createBufferSource();
        noise.buffer = noiseBuf;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2000; // Let only high frequencies through (glassy)

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + duration);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxGain);

        this._registerTransientVoice(noise, gain);
        this._attachCleanup(noise, filter);
        noise.start(t);
        noise.stop(t + duration);
    }

    /**
     * AT: Voidweaver absorption. A meteor that meets the event horizon is
     * captured rather than shattered, so it must NOT reuse playShatter(): the
     * glassy high-passed burst reads as damage. This is a falling sweep (the
     * meteor being dragged inward) resolving into a short low bloom as the
     * ward closes over it.
     */
    playVoidAbsorb() {
        if (!this._canPlaySfx()) return;
        this._resumeContext();
        const t = this.ctx.currentTime;

        // Inward pitch sweep — the object falling toward the well.
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(720, t);
        osc.frequency.exponentialRampToValueAtTime(70, t + 0.34);

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2400, t);
        filter.frequency.exponentialRampToValueAtTime(220, t + 0.34);

        oscGain.gain.setValueAtTime(0.0001, t);
        oscGain.gain.exponentialRampToValueAtTime(0.30, t + 0.05);
        oscGain.gain.exponentialRampToValueAtTime(0.01, t + 0.34);

        osc.connect(filter);
        filter.connect(oscGain);
        oscGain.connect(this.sfxGain);

        // Quiet sub thud on capture, so the absorption has weight without the
        // damage connotation of playExplosion().
        const sub = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(120, t);
        sub.frequency.exponentialRampToValueAtTime(45, t + 0.3);
        subGain.gain.setValueAtTime(0.22, t);
        subGain.gain.exponentialRampToValueAtTime(0.01, t + 0.3);
        sub.connect(subGain);
        subGain.connect(this.sfxGain);

        this._registerTransientVoice(osc, oscGain);
        this._registerTransientVoice(sub, subGain);
        this._attachCleanup(osc, filter);
        osc.start(t);
        osc.stop(t + 0.36);
        sub.start(t);
        sub.stop(t + 0.32);
    }

    startBackgroundMusic() {
        this._resumeContext();
        if (this.isPlayingBg) return;
        this.isPlayingBg = true;

        const t = this.ctx.currentTime;

        // Create a deep, mysterious drone using two detuned triangles
        this.bgOscillator1 = this.ctx.createOscillator();
        this.bgOscillator2 = this.ctx.createOscillator();

        this.bgOscillator1.type = 'sine';
        this.bgOscillator2.type = 'triangle';

        // Deep bass note (A1 ~ 55Hz)
        this.bgOscillator1.frequency.value = 55;
        this.bgOscillator2.frequency.value = 55.5; // Slight detune for phasing/chorus effect

        // Lowpass filter to muffle it into the background
        this.bgFilter = this.ctx.createBiquadFilter();
        this.bgFilter.type = 'lowpass';
        this.bgFilter.frequency.value = 400;

        // Add slow LFO to the filter frequency to make it "breathe"
        this.bgLfo = this.ctx.createOscillator();
        this.bgLfo.type = 'sine';
        this.bgLfo.frequency.value = 0.1; // Very slow, 10 seconds per cycle
        this.bgLfoGain = this.ctx.createGain();
        this.bgLfoGain.gain.value = 150; // Sweeps filter by 150hz
        this.bgLfo.connect(this.bgLfoGain);
        this.bgLfoGain.connect(this.bgFilter.frequency);
        this.bgLfo.start();

        this.bgGain = this.ctx.createGain();
        this.bgGain.gain.setValueAtTime(0.001, t); // Start silent
        this.bgGain.gain.linearRampToValueAtTime(0.2, t + 4); // Fade in over 4 seconds

        this.bgOscillator1.connect(this.bgFilter);
        this.bgOscillator2.connect(this.bgFilter);
        this.bgFilter.connect(this.bgGain);
        this.bgGain.connect(this.masterGain);

        // --- Tension Layer (Smooth Choir/Ethereal) ---
        this.tensionOsc = this.ctx.createOscillator();
        this.tensionOsc.type = 'sine';
        this.tensionOsc.frequency.value = 880; // High A5 note

        this.tensionGain = this.ctx.createGain();
        this.tensionGain.gain.setValueAtTime(0, t); // Starts completely silent

        // Slow tremolo effect to make it shimmer instead of gating rapidly
        this.tensionLfo = this.ctx.createOscillator();
        this.tensionLfo.type = 'sine';
        this.tensionLfo.frequency.value = 4; // 4Hz gentle wobble

        this.tremoloGain = this.ctx.createGain();
        this.tremoloGain.gain.value = 0.5; // Base level
        this.tensionLfo.connect(this.tremoloGain.gain);

        this.tensionOsc.connect(this.tremoloGain);
        this.tremoloGain.connect(this.tensionGain);
        this.tensionGain.connect(this.masterGain);

        this.tensionOsc.start(t);
        this.tensionLfo.start(t);

        this.bgOscillator1.start(t);
        this.bgOscillator2.start(t);
    }

    stopBackgroundMusic() {
        if (!this.isPlayingBg) return;
        this.isPlayingBg = false;

        const t = this.ctx.currentTime;
        if (this.bgGain) {
            // Fade out
            this.bgGain.gain.cancelScheduledValues(t);
            this.bgGain.gain.setValueAtTime(this.bgGain.gain.value, t);
            this.bgGain.gain.linearRampToValueAtTime(0.01, t + 2);

            if (this.tensionGain) {
                this.tensionGain.gain.cancelScheduledValues(t);
                this.tensionGain.gain.setValueAtTime(this.tensionGain.gain.value, t);
                this.tensionGain.gain.linearRampToValueAtTime(0, t + 1);
            }

            setTimeout(() => {
                if (this.bgOscillator1) { try { this.bgOscillator1.stop(); this.bgOscillator1.disconnect(); } catch (_) {} this.bgOscillator1 = null; }
                if (this.bgOscillator2) { try { this.bgOscillator2.stop(); this.bgOscillator2.disconnect(); } catch (_) {} this.bgOscillator2 = null; }
                if (this.bgLfo) { try { this.bgLfo.stop(); this.bgLfo.disconnect(); } catch (_) {} this.bgLfo = null; }
                if (this.bgLfoGain) { try { this.bgLfoGain.disconnect(); } catch (_) {} this.bgLfoGain = null; }
                if (this.bgFilter) { try { this.bgFilter.disconnect(); } catch (_) {} this.bgFilter = null; }
                if (this.bgGain) { try { this.bgGain.disconnect(); } catch (_) {} this.bgGain = null; }

                if (this.tensionOsc) { try { this.tensionOsc.stop(); this.tensionOsc.disconnect(); } catch (_) {} this.tensionOsc = null; }
                if (this.tensionLfo) { try { this.tensionLfo.stop(); this.tensionLfo.disconnect(); } catch (_) {} this.tensionLfo = null; }
                if (this.tremoloGain) { try { this.tremoloGain.disconnect(); } catch (_) {} this.tremoloGain = null; }
                if (this.tensionGain) { try { this.tensionGain.disconnect(); } catch (_) {} this.tensionGain = null; }
            }, 2100);
        }
    }

    setMusicIntensity(intensity) {
        if (!this.isPlayingBg) return;

        // Clamp intensity 0.0 to 1.0 (e.g. maxes out at 50 combo)
        this.currentIntensity = Math.min(1.0, Math.max(0, intensity));

        const t = this.ctx.currentTime;
        const targetFreq = 55 + (this.currentIntensity * 10); // Slight pitch up (55Hz -> 65Hz)
        const targetFilterFreq = 400 + (this.currentIntensity * 600); // 400 up to 1000Hz

        if (this.bgOscillator1) {
            this.bgOscillator1.frequency.linearRampToValueAtTime(targetFreq, t + 0.5);
        }
        if (this.bgOscillator2) {
            this.bgOscillator2.frequency.linearRampToValueAtTime(targetFreq + 0.5, t + 0.5);
        }

        if (this.bgFilter) {
            this.bgFilter.frequency.setTargetAtTime(targetFilterFreq, t, 0.5);
        }

        // Fade in the shimmering tension layer gracefully
        if (this.tensionGain) {
            let tensionVolume = 0;
            if (this.currentIntensity > 0.4) {
                // Map the upper 60% of intensity to volume
                tensionVolume = (this.currentIntensity - 0.4) * 1.5 * 0.1;
            }
            this.tensionGain.gain.setTargetAtTime(tensionVolume, t, 0.5);
        }
    }

    playSound(soundName) {
        if (soundName === 'click') {
            this.playUiClick();
        } else if (soundName === 'tada') {
            this.playLevelUp();
        }
    }
}
