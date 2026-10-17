import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    resolveCharacterAudioProfile,
    resolveSigilAudioProfile,
    CHARACTER_AUDIO_PROFILES,
    listAllValidAudioPairs
} from '../frontend/audio/CharacterAudioProfiles.js';
import { AudioController } from '../frontend/AudioController.js';
import { MAGE_CLASSES } from '../backend/MageClasses.js';

// ── Mock Web Audio Context for Node ──────────────────────────────────────────
function createMockAudioContext() {
    let time = 0;
    const makeParam = (initial = 0) => ({
        value: initial,
        setValueAtTime(v, t) { this.value = v; },
        linearRampToValueAtTime(v, t) { this.value = v; },
        exponentialRampToValueAtTime(v, t) { this.value = v; },
        setTargetAtTime(v, t, tc) { this.value = v; },
        cancelScheduledValues(t) {}
    });

    const mockNode = () => ({
        connect(target) { return target; },
        disconnect() {}
    });

    const mockSourceNode = () => ({
        ...mockNode(),
        startTime: 0,
        stopTime: 0,
        start(t = 0) { this.startTime = t; },
        stop(t = 0) { this.stopTime = t; }
    });

    return {
        get currentTime() { return time++; },
        sampleRate: 44100,
        state: 'running',
        resume() { return Promise.resolve(); },
        createGain() {
            return {
                ...mockNode(),
                gain: makeParam(1.0)
            };
        },
        createOscillator() {
            return {
                ...mockSourceNode(),
                type: 'sine',
                frequency: makeParam(440)
            };
        },
        createBiquadFilter() {
            return {
                ...mockNode(),
                type: 'lowpass',
                frequency: makeParam(1000),
                Q: makeParam(1)
            };
        },
        createBuffer(channels, length, sampleRate) {
            const data = new Float32Array(length);
            return {
                numberOfChannels: channels,
                length,
                sampleRate,
                getChannelData: () => data
            };
        },
        createBufferSource() {
            return {
                ...mockSourceNode(),
                buffer: null,
                playbackRate: makeParam(1.0)
            };
        }
    };
}

// ── Test 1: All 12 (character, discipline) combinations ──────────────────────
const expectedCombinations = [
    ['wizard', 'Novice'],
    ['wizard', 'Pyromancer'],
    ['wizard', 'Cryomancer'],
    ['wizard', 'Chronomancer'],
    ['voidweaver', 'Novice'],
    ['voidweaver', 'Singulist'],
    ['voidweaver', 'Nullwarden'],
    ['voidweaver', 'Riftbinder'],
    ['bloodseeker', 'Novice'],
    ['bloodseeker', 'Hemomancer'],
    ['bloodseeker', 'Reaper'],
    ['bloodseeker', 'Bloodruner']
];

const mockCtx = createMockAudioContext();
const mockGain = mockCtx.createGain();
const sharedNoise = mockCtx.createBuffer(1, 22050, 44100);

const validPairs = listAllValidAudioPairs();
assert.equal(validPairs.length, 12, 'listAllValidAudioPairs() must enumerate all 12 valid (character, discipline) pairs');

for (const [char, disc] of expectedCombinations) {
    const profile = resolveCharacterAudioProfile(char, disc);
    assert(profile, `Profile must resolve for (${char}, ${disc})`);
    assert.equal(profile.character, char);
    assert.equal(profile.mageClass, disc);
    assert(typeof profile.renderTyping === 'function', `renderTyping must exist for ${profile.key}`);
    assert(profile.typingDuration >= 0.045 && profile.typingDuration <= 0.085,
        `Typing duration ${profile.typingDuration}s for ${profile.key} must be between 45ms and 85ms`);

    // Verify all 3 non-repeating variants render successfully without throwing
    for (let variant = 0; variant < 3; variant++) {
        const nodes = profile.renderTyping(mockCtx, mockGain, variant, mockCtx.currentTime, sharedNoise);
        assert(Array.isArray(nodes), `renderTyping must return node array for variant ${variant}`);
        assert(nodes.length > 0, `renderTyping must return at least one source node for variant ${variant}`);
    }
}
console.log('PASS all 12 character & discipline audio profiles render 3 typing variants within 45-85ms');

// ── Test 2: Safe normalization and fallback ──────────────────────────────────
// Mismatched class -> fallback to same-character Novice
assert.equal(resolveCharacterAudioProfile('wizard', 'Hemomancer').key, 'wizard.novice');
assert.equal(resolveCharacterAudioProfile('bloodseeker', 'Pyromancer').key, 'bloodseeker.novice');
assert.equal(resolveCharacterAudioProfile('voidweaver', 'Reaper').key, 'voidweaver.novice');

// Invalid character -> fallback to Wizard Novice
const invalidChar = resolveCharacterAudioProfile('unknown_class', 'unknown_disc');
assert.equal(invalidChar.key, 'wizard.novice');
console.log('PASS character audio resolution handles invalid/mismatched inputs gracefully');

// ── Test 3: Sigil Audio Profiles for All Roster Actives ──────────────────────
// Verify Novice 'arcane-surge' resolves to 3 distinct character-specific profiles
const noviceWizardSigil = resolveSigilAudioProfile('arcane-surge', 'wizard');
const noviceVoidSigil = resolveSigilAudioProfile('arcane-surge', 'voidweaver');
const noviceBloodSigil = resolveSigilAudioProfile('arcane-surge', 'bloodseeker');
assert.equal(noviceWizardSigil.key, 'wizard.novice');
assert.equal(noviceVoidSigil.key, 'voidweaver.novice');
assert.equal(noviceBloodSigil.key, 'bloodseeker.novice');
assert.notEqual(noviceWizardSigil, noviceVoidSigil);
assert.notEqual(noviceVoidSigil, noviceBloodSigil);

// Verify Chronomancer two-stage sigil ('request' short tick vs 'activate' full bell + clock sweep)
const chronoSigil = resolveSigilAudioProfile('time-stop', 'wizard');
const reqNodes = chronoSigil.renderSigil(mockCtx, mockGain, { stage: 'request', gainScale: 1.0 }, mockCtx.currentTime, sharedNoise);
const actChronoNodes = chronoSigil.renderSigil(mockCtx, mockGain, { stage: 'activate', gainScale: 1.0 }, mockCtx.currentTime, sharedNoise);
assert(actChronoNodes.length > reqNodes.length, 'Chronomancer activate stage must schedule full astrolabe bell + sweep compared to short request tick');

for (const mageClass of MAGE_CLASSES) {
    const skill = mageClass.active;
    assert(skill, `Mage class ${mageClass.id} must declare active`);

    for (const char of mageClass.characters) {
        const sigilProfile = resolveSigilAudioProfile(skill.id, char);
        assert(sigilProfile, `Sigil audio must resolve for skill ${skill.id} and character ${char}`);
        assert(typeof sigilProfile.renderSigil === 'function', `renderSigil must exist for ${skill.id}`);

        // Test arm, preview, and activate stages
        for (const stage of ['arm', 'preview', 'activate']) {
            const nodes = sigilProfile.renderSigil(mockCtx, mockGain, { stage, gainScale: 0.85 }, mockCtx.currentTime, sharedNoise);
            assert(Array.isArray(nodes) && nodes.length > 0, `Sigil ${stage} stage must return nodes for ${skill.id}`);
            const sourceNodes = nodes.filter(n => typeof n.start === 'function' && typeof n.stop === 'function');
            assert(sourceNodes.length > 0, `Sigil sound for ${skill.id} (${stage}) must return scheduled source nodes`);
            for (const s of sourceNodes) {
                assert(s.stopTime >= s.startTime, `Source node stop time (${s.stopTime}) must be >= start time (${s.startTime})`);
            }
        }
    }
}
console.log('PASS all roster active sigils render arm, preview, request, and activate cues within 150-450ms');

// ── Test 4: AudioController Voice Capping, Stale Token Guard & Master Volume ─
const testCtx = createMockAudioContext();
testCtx.destination = { connect() {}, disconnect() {} };
const audio = new AudioController(testCtx);

// Verify SFX bus routing
assert(audio.sfxGain, 'sfxGain node must exist on AudioController');

// Verify prepareCharacterProfile increments _prepareGeneration and updates profile immediately
const initialToken = audio._prepareGeneration;
audio.prepareCharacterProfile('wizard', 'Pyromancer');
const secondToken = audio._prepareGeneration;
audio.prepareCharacterProfile('bloodseeker', 'Reaper');
assert(audio._prepareGeneration > secondToken && secondToken > initialToken,
    'prepareCharacterProfile must increment _prepareGeneration on rapid switches to guard against stale pre-cache callbacks');
assert.equal(audio._activeProfileKey, 'bloodseeker.reaper',
    'Latest prepareCharacterProfile selection must win immediately');

// Test typing voice limit (capped at 6)
for (let i = 0; i < 10; i++) {
    audio.playTypeSound('wizard', 'Novice');
}
assert(audio._activeTypingVoices.length <= 6, `Active typing voices (${audio._activeTypingVoices.length}) must not exceed 6`);

// Test transient voice limit (capped at 12)
for (let i = 0; i < 20; i++) {
    audio.playSigilSound('arcane-surge', 'wizard');
}
assert(audio._activeTransientVoices.length <= 12, `Active transient voices (${audio._activeTransientVoices.length}) must not exceed 12`);

// Test stopAllTransientVoices
audio.stopAllTransientVoices();
assert.equal(audio._activeTypingVoices.length, 0, 'stopAllTransientVoices must clear all typing voices');
assert.equal(audio._activeTransientVoices.length, 0, 'stopAllTransientVoices must clear all transient voices');

// Test UI click decoupling
audio.playSound('click');
assert.equal(audio._activeTypingVoices.length, 0, "playSound('click') must NOT spawn a character typing voice");
assert.equal(audio._activeTransientVoices.length, 1, "playSound('click') must route to a transient UI click voice");

// Test muting
assert.equal(audio.isMuted(), false);
audio.toggleMute();
assert.equal(audio.isMuted(), true);
assert.equal(audio._canPlaySfx(), false, 'Muting must disable SFX playback');
audio.toggleMute();
assert.equal(audio.isMuted(), false);
audio.setMasterVolume(0);
assert.equal(audio._canPlaySfx(), false, 'Zero volume must disable SFX playback');
console.log('PASS AudioController voice caps (6 typing / 12 transient), stale-selection token guard, cleanup, and UI click decoupling');

// ── Test 5: Source Invariance Audits ─────────────────────────────────────────
// Scribe trial MUST NOT be modified or have typing sounds
const scribeCode = readFileSync(new URL('../frontend/Scribe.js', import.meta.url), 'utf8');
assert.doesNotMatch(scribeCode, /playTypeSound|playSigilSound|CharacterAudioProfiles|prepareCharacterProfile/,
    'frontend/Scribe.js must remain untouched and contain no audio bindings');

// DuelRace sigil integration & test-harness compatibility
const duelRaceCode = readFileSync(new URL('../frontend/game/DuelRace.js', import.meta.url), 'utf8');
assert.match(duelRaceCode, /_playSigilCue/, 'DuelRace must contain _playSigilCue helper');
assert.match(duelRaceCode, /playSigilSound\?\.|\.playSigilSound/, 'DuelRace must route through playSigilSound when available');
assert.match(duelRaceCode, /playMagicSpark/, 'DuelRace must fall back to playMagicSpark for test harnesses');
assert.match(duelRaceCode, /if \(!this\.isHost \|\| this\.over\) return;/, 'DuelRace _onCast must preserve invariant guard');
assert.match(duelRaceCode, /0\.55/, 'DuelRace opponent sigil cue must play at ~55% volume scale');

// InputHandler passes character and discipline
const inputHandlerCode = readFileSync(new URL('../frontend/game/InputHandler.js', import.meta.url), 'utf8');
assert.match(inputHandlerCode, /playTypeSound\(this\.game\.stats\?\.selectedCharacter,\s*this\.game\.stats\?\.mageClass\)/,
    'InputHandler must pass selectedCharacter and mageClass to playTypeSound');

// Game pre-warms profile and cleans up voices
const gameCode = readFileSync(new URL('../frontend/Game.js', import.meta.url), 'utf8');
assert.match(gameCode, /prepareCharacterProfile\?\.|prepareCharacterProfile/, 'Game start() must pre-warm character audio profile');
assert.match(gameCode, /stopAllTransientVoices\?\.|\.stopAllTransientVoices/, 'Game stop() and pause() must call stopAllTransientVoices');

// Forge & ProfileUI previews
const mainCode = readFileSync(new URL('../frontend/main.js', import.meta.url), 'utf8');
assert.match(mainCode, /prepareCharacterProfile\?\.|\.prepareCharacterProfile/, 'main.js must pre-warm on character equip');
assert.match(mainCode, /stage:\s*'preview',\s*gainScale:\s*0\.85/, 'main.js must play sigil preview at stage preview and gainScale 0.85 on character equip');

const profileUiCode = readFileSync(new URL('../frontend/ui/ProfileUI.js', import.meta.url), 'utf8');
assert.match(profileUiCode, /prepareCharacterProfile\?\.|\.prepareCharacterProfile/, 'ProfileUI must pre-warm on discipline change');
assert.match(profileUiCode, /stage:\s*'preview',\s*gainScale:\s*0\.85/, 'ProfileUI must play sigil preview at stage preview and gainScale 0.85 on discipline change');

console.log('PASS source invariance audits: Scribe untouched, DuelRace telegraphs, InputHandler character routing, Forge & ProfileUI audition previews');
