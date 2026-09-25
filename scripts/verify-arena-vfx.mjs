/**
 * AT-F17 Arena VFX hierarchy guard.
 *
 * The class active is the primary focal effect around a mage. The endless
 * combo remains a readable secondary aura, but an armed active must not allow
 * the Archmage's 150/200 visual tiers to overtake the sigil. The Chronomancer
 * Time Stop seal remains centered and its outer arc remains the expiry clock.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const game = read('frontend/Game.js');
const renderer = read('frontend/game/CharacterRenderer.js');
const sigils = read('frontend/game/ArenaSigils.js');
const combat = read('frontend/game/CombatSystem.js');
const particles = read('frontend/Particle.js');
const stats = read('backend/Stats.js');
const main = read('frontend/main.js');
const css = read('frontend/style.css');
const audio = read('frontend/AudioController.js');
const boss = read('frontend/Boss.js');
const projectile = read('frontend/Projectile.js');
const input = read('frontend/game/InputHandler.js');
const updateStart = game.indexOf('        for (let i = this.words.length - 1; i >= 0; i--) {');
const updateEnd = game.indexOf('        // Update particles via ParticlePool', updateStart);
const collision = updateStart >= 0 && updateEnd > updateStart ? game.slice(updateStart, updateEnd) : '';

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}

/**
 * Slice a method out of Game.js by its 4-space-indented signature and return it
 * as a real function, so the blade-lease ROTATION can be executed rather than
 * pattern-matched. The same technique the other guards use on Stats.js.
 */
function sliceMethod(src, name) {
    const at = src.indexOf(`\n    ${name}(`);
    if (at < 0) return null;
    const end = src.indexOf('\n    }\n', at);
    if (end < 0) return null;
    const body = src.slice(at + 1, end + 6);
    try {
        return new Function(`return function ${body}`)();
    } catch {
        return null;
    }
}

check('the Arena sigil is larger than the previous 128px base radius',
    game.includes('const baseRadius = Math.round(154 * scale);'));
check('both Arena team slots pass the active-skill visual state to the renderer',
    game.includes('arenaSkillActive: true') &&
    game.includes('arenaSkillActive: !!this.duelAuras[oppSlot]'));
check('the real combo is preserved while only the visual escalation is capped',
    renderer.includes('const rawCombo = stats ? (stats.combo || 0) : 0;') &&
    renderer.includes('Math.min(rawCombo, 100)'));
check('the armed-sigil cap is conditional, so unarmed Survival visuals are unchanged',
    renderer.includes('stats && stats.arenaSkillActive ? Math.min(rawCombo, 100) : rawCombo'));
check('the centered Chronomancer expiry seal remains the Arena-wide Time Stop visual',
    sigils.includes('export function drawTimeStopSeal') &&
    sigils.includes('const cx = width / 2, cy = height / 2;') &&
    sigils.includes('ctx.arc(0, 0, r + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)'));
check('the blood-oath sigil is registered without adding a second active table',
    sigils.includes("'blood-pact': { color: '#ff1744'") &&
        sigils.includes('else if (skillId === \'blood-pact\') drawBloodMark(ctx, inner);'));
check('the character-specific streak overlay is wired for both Arena slots',
    game.includes('CharacterRenderer.drawStreakOverlay(') &&
        game.includes('selfCharacter, selfCombo') && game.includes('oppCharacter, oppCombo') &&
        game.includes("arenaSkillActive: !!this.duelAuras[oppSlot]"));
check('the merged Voidweaver streak is a persistent event horizon with complete accretion and lensing geometry',
    renderer.includes('One persistent event horizon') &&
        renderer.includes("ctx.arc(0, 0, r, 0, Math.PI * 2)") &&
        renderer.includes('two elliptic accretion bands') &&
        renderer.includes('complete inward-pointing spokes show space falling toward the') &&
        renderer.includes('complete concentric lens rings') &&
        renderer.includes('bright photon ring'));
check('the merged Bloodseeker streak is a persistent oath with moon phases, upward life-flow, and an execution maximum',
    renderer.includes('Full Blood Oath boundary persists') &&
        renderer.includes('Blood Moon phase') &&
        renderer.includes('Blood rises from the hem through the oath') &&
        renderer.includes('complete nested execution rings') &&
        renderer.includes('eclipse corona'));
check('the streak overlay now has tiered Voidweaver and Bloodseeker visual tiers',
    renderer.includes('if (combo < 10) return;') &&
        renderer.includes('CharacterRenderer._drawVoidStreak') &&
        renderer.includes('CharacterRenderer._drawBloodStreak') &&
        renderer.includes('combo >= 200 ? 5'));
check('Voidweaver Supernova is a 100ms stepped inward Singularity collapse',
    combat.includes("kind: 'void-collapse'") && combat.includes('spawnVoidImplosion(cx, cy') &&
        game.includes('_drawVoidCollapseSupernova()') && game.includes("ctx.fillText('SINGULARITY'") &&
        game.includes('SPACE BENDS INWARD') && game.includes('maxRadius * collapse'));
check('Voidweaver Supernova uses target-seeking motes instead of the outward shockwave',
    combat.includes('if (isVoidweaver)') && combat.includes('this.spawnVoidImplosion(cx, cy') &&
        combat.includes('p.targetX = cx') && combat.includes('p.targetY = cy') &&
        combat.includes('p.isVoidMote = true') && particles.includes('else if (this.isVoidMote)') &&
        game.includes('Lensed release: stretched light leaves the singularity'));
check('Bloodseeker Supernova places the Moon upper-right and a complete central sigil',
    combat.includes("kind: 'blood-moon'") && combat.includes('duration: 1000') &&
        game.includes('_drawBloodMoonSupernova()') && game.includes('Math.floor(elapsed / 100)') &&
        game.includes('const moonX = w * 0.82') && game.includes('const moonY = h * 0.18') &&
        game.includes('ctx.translate(w / 2, h / 2)') && game.includes('const sigilSpin') &&
        game.includes("ctx.fillText('BLOOD MOON'"));
check('Bloodseeker Supernova keeps the shared meteor-shatter foundation and palette',
    combat.includes('this.spawnBurst(cx, cy, palette.particles);') &&
        combat.includes("character === 'bloodseeker'") &&
        combat.includes("shockwave: 'shockwave_red'"));
check('Supernova reuses meteor-shatter bursts and has character-specific palettes',
    combat.includes('this.spawnBurst(cx, cy, palette.particles);') &&
        combat.includes('_supernovaPalette()') &&
        combat.includes("character === 'voidweaver'") &&
        combat.includes("character === 'bloodseeker'") &&
        combat.includes("shockwave: 'shockwave_purple'") &&
        combat.includes("shockwave: 'shockwave_red'"));
check('an armed active quiets, but does not erase, the character streak overlay',
    renderer.includes('arenaSkillActive ? 0.48 : 1') && renderer.includes('skipStreakOverlay') &&
        renderer.includes('!!stats?.arenaSkillActive'));
check('every new character-family sigil is registered in the production renderer',
    ['crushing-gravity', 'event-horizon', 'rift-tether', 'final-cut', 'bloodletting']
        .every((id) => sigils.includes(`'${id}': { color:`)) &&
        sigils.includes("skillId === 'crushing-gravity'") &&
        sigils.includes("skillId === 'final-cut' || skillId === 'bloodletting'"));
check('the active sigil is painted before the mage sprite, keeping the body readable',
    game.indexOf('this._drawDuelAuras(frozen);') < game.indexOf('this._drawTeamMage('));

check('Survival uses one outer Voidweaver absorption ward and no Bloodseeker ward ring',
    game.includes("const defenseMode = this.stats.getSurvivalDefenseMode()") &&
        game.includes("this._barrierImg('voidward', '#00e5ff', radius, 0)") &&
        game.includes("else if (defenseMode !== 'lives')") &&
        !game.includes("this.stats.selectedCharacter === 'bloodseeker' ? 'bloodward'"));
check('Voidweaver has a pooled meteor-absorption animation centred on the ward',
    combat.includes('spawnVoidAbsorption(x, y)') &&
        game.includes('this.combatSystem.spawnVoidAbsorption(wizX, shieldY)') &&
        !game.includes('this.combatSystem.spawnVoidAbsorption(word.x, word.y)'));
check('Bloodseeker ready Moon is a progressive background charge indicator, hides during the cast, and returns as mana refills',
    game.includes('_drawReadyBloodMoon()') &&
        game.includes("if (this.supernovaFx) return;") &&
        game.includes("const readiness = Math.max(0, Math.min(1, this.stats.mana / 100));") &&
        game.includes("const backgroundAlpha = 0.18 + readiness * 0.24;") &&
        game.includes("this.stats.selectedCharacter !== 'bloodseeker'"));
check('Survival defense pools share stable character colors',
    stats.includes("if (this.selectedCharacter === 'voidweaver') return '#00e5ff';") &&
        stats.includes("if (this.selectedCharacter === 'bloodseeker') return '#ff1744';") &&
        stats.includes('heart.style.backgroundColor = defenseColor;') &&
        stats.includes('heart.style.boxShadow = `0 0 10px ${defenseColor}`;'));
check('the Voidweaver shield is a clean circle with no vertical radial spokes',
    game.includes("this._barrierImg('voidward', '#00e5ff', radius, 0)") &&
        game.includes('no radial spokes') &&
        !game.includes('ctx.lineTo(cx + Math.cos(a) * (radius + 10), cy + Math.sin(a) * (radius + 10));'));
check('boss meteor impact feedback is character-specific and distinct from ordinary streak breaks',
    game.includes("'SHIELD BROKEN'") && game.includes("'ABSORPTION −1'") &&
        game.includes("'LIFE LOST'") &&
        collision.includes('consumeSurvivalDefense()') &&
        collision.includes('STREAK BROKEN') &&
        !collision.includes('new FloatingText("Word Missed"') &&
        !collision.includes('METEOR STRIKE') && !collision.includes('METEOR MISSED'));
check('the same meteor impact path consumes exactly one Wizard shield or Voidweaver absorption',
    game.includes('const defense = this.stats.consumeSurvivalDefense();') &&
        game.includes("defense.mode === 'absorption'") &&
        game.includes("defense.mode === 'barriers'") &&
        game.includes("'ABSORPTION −1'") && game.includes("'SHIELD BROKEN'"));
check('Bloodseeker uses 3/4 lives and Voidweaver uses 3/4 absorption charges',
    stats.includes("return this.hasSkill('life') ? 4 : 3") &&
        stats.includes("return 'absorption'") && stats.includes("return 'lives'") &&
        /mode === 'barriers'[\s\S]{0,100}index < \(this\.lives - 1\)[\s\S]{0,100}index < this\.lives/.test(stats));
check('Forge selection resets the previous glow and profile scrolling contains its cards',
    main.includes("card.style.removeProperty('box-shadow')") &&
        css.includes('#profile-menu #character-skin-grid') &&
        css.includes('contain: layout paint') &&
        css.includes('overscroll-behavior: contain') &&
        css.includes('transform: none'));
check('Voidweaver activates Space Slowed only after a surviving boss hit',
    game.includes('this.voidWardUntil = Date.now() + 1500') &&
        game.includes("'SPACE SLOWED'") &&
        game.includes("defense.mode === 'absorption'") &&
        game.includes('defense.before > 1'));
check('Bloodseeker rebuilds one life at each 25-combo Survival milestone',
    stats.includes("this.selectedCharacter === 'bloodseeker'") &&
        stats.includes('this.combo % 25 === 0') &&
        stats.includes('this.lives < maxLives') &&
        game.includes("BLOOD OATH +1 LIFE"));

check('the Wizard streak overlay is removed; its complete mandala is the only streak circle',
    !renderer.includes('_drawWizardStreak') &&
    !/_drawWizardStreak\(/.test(renderer) &&
    !/for \(let i = 0; i < 8; i\+\+\) \{\s*\n\s*const a = \(i \* Math\.PI\) \/ 4 \+ combo \* 0\.0002;/.test(renderer) &&
    renderer.includes('The Wizard deliberately has NO streak overlay') &&
    renderer.includes("_drawVoidStreak(ctx, combo, tier, pulse, lowQ, now)") &&
    renderer.includes("_drawBloodStreak(ctx, combo, tier, pulse, lowQ, now)"));
check('the Voidweaver absorbs meteors with a distinct capture treatment, not a shatter',
    game.includes('this.audio.playVoidAbsorb();') &&
    audio.includes('playVoidAbsorb() {') &&
    collision.includes("const isVoidAbsorb = defense.mode === 'absorption';") &&
    collision.includes('this.combatSystem.spawnVoidAbsorption(wizX, shieldY);') &&
    !collision.includes('this.combatSystem.spawnVoidAbsorption(word.x, word.y);') &&
    collision.includes('this.audio.playShatter();'));
check('the absorption sound is a descending capture sweep, not the glassy shatter',
    audio.includes('playVoidAbsorb() {') &&
    /playVoidAbsorb\(\) \{[\s\S]{0,1800}exponentialRampToValueAtTime\(70, t \+ 0\.34\)/.test(audio) &&
    /playVoidAbsorb\(\) \{[\s\S]{0,1800}osc\.type = 'sine'/.test(audio) &&
    // playShatter must remain the high-passed glass burst it always was.
    /playShatter\(\) \{[\s\S]{0,900}filter\.type = 'highpass'/.test(audio));

// ── executed behaviour: real Boss HP + takeDamage, and the damage profiles ──
// Boss.js only touches `window` inside draw(), so the HP table and the damage
// transition are executed here against the shipped class, not a copy.
const { Boss } = await import(pathToFileURL(join(root, 'frontend/Boss.js')).href);

const fireBoss = new Boss(1000, 600, 'fire', 1);
const iceBoss = new Boss(1000, 600, 'ice', 1);
check('boss HP is stretched so a fight outlasts two words',
    fireBoss.maxHealth === 16 && iceBoss.maxHealth === 24,
    `fire=${fireBoss.maxHealth} ice=${iceBoss.maxHealth}`);
check('the elemental table is untouched: each element keeps its own speed and colour',
    fireBoss.attackInterval === 2000 * Math.max(0.5, 1 - 0.1) &&
    fireBoss.color === '#ff4500' && fireBoss.auraColor === '#ff8c00' &&
    fireBoss.title === 'IGNIS · PYROLORD' && iceBoss.color === '#00e5ff' &&
    iceBoss.title === 'GLACIES · FROST REAVER',
    `fireInterval=${fireBoss.attackInterval}`);
check('elemental relative toughness is preserved (ice still outlasts fire)',
    iceBoss.maxHealth / 4 === fireBoss.maxHealth / 4 * 1.5);

const hpBoss = new Boss(1000, 600, 'fire', 1);
hpBoss.takeDamage();
check('takeDamage() with no argument still removes exactly 1 (historic call sites)',
    hpBoss.maxHealth - hpBoss.health === 1, `lost=${hpBoss.maxHealth - hpBoss.health}`);
hpBoss.takeDamage(5);
check('takeDamage(amount) applies an explicit amount',
    hpBoss.maxHealth - hpBoss.health === 6, `lost=${hpBoss.maxHealth - hpBoss.health}`);
hpBoss.takeDamage(9999);
check('an over-killing strike still clamps to 0 and kills exactly once',
    hpBoss.health === 0 && hpBoss.isDead === true);
const clampBoss = new Boss(1000, 600, 'fire', 1);
clampBoss.takeDamage(0);
clampBoss.takeDamage(-3);
clampBoss.takeDamage(NaN);
check('a nonsense amount falls back to 1 instead of healing or freezing the boss',
    clampBoss.maxHealth - clampBoss.health === 3 && !clampBoss.isDead,
    `lost=${clampBoss.maxHealth - clampBoss.health}`);

// The damage profiles are pure math over game state, so they are executed
// against the real CombatSystem with a minimal game stub.
const { CombatSystem } = await import(pathToFileURL(join(root, 'frontend/game/CombatSystem.js')).href);
globalThis.window = { __atLowQuality: true };
const stubGame = (character, combo, bossHealth, maxHealth) => ({
    stats: { selectedCharacter: character, combo },
    boss: { health: bossHealth, maxHealth, takeDamage() { } },
    isBossPhase: true
});
const dmgFor = (character, combo, health, maxHealth, len) => {
    const sys = new CombatSystem(stubGame(character, combo, health, maxHealth));
    return sys.bossStrikeDamage(len);
};
check('Wizard deals a steady arcane bolt that scales slightly with word length',
    dmgFor('wizard', 0, 100, 100, 4) === 4 && dmgFor('wizard', 0, 100, 100, 12) === 6 &&
    dmgFor('wizard', 0, 100, 100, 0) === 3,
    `4=${dmgFor('wizard', 0, 100, 100, 4)} 12=${dmgFor('wizard', 0, 100, 100, 12)}`);
check('Voidweaver boss damage scales with the caster streak and is capped',
    dmgFor('voidweaver', 0, 100, 100, 8) === 2 &&
    dmgFor('voidweaver', 40, 100, 100, 8) === 4 &&
    dmgFor('voidweaver', 100, 100, 100, 8) === 7 &&
    dmgFor('voidweaver', 5000, 100, 100, 8) === 7,
    `c0=${dmgFor('voidweaver', 0, 100, 100, 8)} c40=${dmgFor('voidweaver', 40, 100, 100, 8)} max=${dmgFor('voidweaver', 5000, 100, 100, 8)}`);
check('Bloodseeker boss damage scales with the BOSS missing HP, not its own streak',
    // base at len 8 is 5; full-HP target = round(5 * 1.5) = 8, no bonus.
    dmgFor('bloodseeker', 0, 100, 100, 8) === 8 &&
    // 40% missing adds +2, 80% missing adds +4 (capped at +5).
    dmgFor('bloodseeker', 0, 60, 100, 8) === 10 &&
    dmgFor('bloodseeker', 0, 20, 100, 8) === 12 &&
    dmgFor('bloodseeker', 0, 1, 100, 8) === 12 &&
    // its own streak must NOT change its damage
    dmgFor('bloodseeker', 999, 100, 100, 8) === 8,
    `full=${dmgFor('bloodseeker', 0, 100, 100, 8)} hurt=${dmgFor('bloodseeker', 0, 20, 100, 8)}`);
check('the three characters peak differently: self-streak vs target-HP vs steady',
    // Voidweaver peaks on ITS OWN streak, Bloodseeker peaks on the TARGET being
    // hurt, and the Wizard ignores both and stays steady.
    dmgFor('voidweaver', 200, 100, 100, 8) === 7 && dmgFor('voidweaver', 0, 20, 100, 8) === 2 &&
    dmgFor('bloodseeker', 0, 10, 100, 8) === 12 && dmgFor('bloodseeker', 200, 100, 100, 8) === 8 &&
    dmgFor('wizard', 200, 20, 100, 8) === 5 && dmgFor('wizard', 0, 100, 100, 8) === 5);

check('boss HP is raised by a uniform multiplier, not by rebalancing elements',
    boss.includes('const BOSS_HP_SCALE = 4;') &&
    boss.includes('config.hp * difficultyScale * BOSS_HP_SCALE') &&
    // every element keeps its own base HP, speed, colour, aura and title
    ["'fire': { hp: 4, speed: 2000, color: '#ff4500', aura: '#ff8c00', title: 'IGNIS · PYROLORD' }",
     "'ice': { hp: 6, speed: 4500, color: '#00e5ff', aura: '#18ffff', title: 'GLACIES · FROST REAVER' }",
     "'lightning': { hp: 3, speed: 1500, color: '#ffd700', aura: '#ffff00', title: 'FULGUR · STORM ARCHON' }",
     "'void': { hp: 5, speed: 3000, color: '#aa00ff', aura: '#00e5ff', title: 'NIHIL · VOID SOVEREIGN' }"
    ].every((line) => boss.includes(line)) &&
    combat.includes('bossStrikeDamage(wordLength = 0)') &&
    combat.includes("if (character === 'voidweaver')") &&
    combat.includes("if (character === 'bloodseeker')"));
check('the boss strike profile is deterministic and skill-linked, never random',
    combat.includes('const base = 3 + Math.floor(len / 4);') &&
    combat.includes('const streakBonus = Math.min(5, Math.floor(Math.max(0, combo) / 20));') &&
    combat.includes('return Math.max(1, 2 + streakBonus);') &&
    combat.includes('const executeBonus = Math.min(5, Math.floor(missingPct / 20));') &&
    combat.includes('return Math.max(1, Math.round(base * 1.5) + executeBonus);') &&
    combat.includes('return base;') &&
    !/Math\.random\(\)/.test(combat.slice(combat.indexOf('bossStrikeDamage('), combat.indexOf('spawnReaverArc('))));
check('one solved word resolves through the character boss-strike path',
    game.includes('this.combatSystem.strikeBoss(proj.wordLength);') &&
    !/this\.boss\.takeDamage\(\);\s*\n\s*this\.audio\.playExplosion\(\);/.test(game) &&
    projectile.includes('this.wordLength = Number.isFinite(wordLength) && wordLength > 0 ? wordLength : 0;') &&
    input.includes("colors, 'normal', word.text.length)"));
check('takeDamage accepts an amount but every historic call site still works',
    boss.includes('takeDamage(amount = 1)') &&
    combat.includes('const dealt = boss.takeDamage(amount);') &&
    // Nova / Supernova bursts keep their original 3-hit burst
    (game.match(/for \(let j = 0; j < 3; j\+\+\) this\.boss\.takeDamage\(\);/g) || []).length === 1 &&
    (combat.match(/for \(let i = 0; i < 3; i\+\+\) \{/g) || []).length >= 1);

// ── executed behaviour: a dead boss's summons dissolve and cannot hurt ──
// Game.js cannot be imported in plain Node (it transitively pulls in
// supabaseClient, which needs Vite's import.meta.env). So the two methods are
// extracted FROM THE SHIPPED SOURCE TEXT and compiled here. The code that runs
// is the real method body, so editing Game.js still changes what this asserts —
// unlike a hand-written copy of the logic.
const extractMethod = (src, name) => {
    const at = src.indexOf(`\n    ${name}(`);
    if (at < 0) return null;
    const end = src.indexOf('\n    }\n', at);
    return src.slice(at + 1, end < 0 ? src.length : end + 6);
};
const compileMethod = (name, src) => {
    const body = extractMethod(src, name);
    if (!body) throw new Error(`could not extract ${name} from Game.js`);
    // A class method shorthand is not a valid standalone expression, so it is
    // turned into a real function expression. The BODY is the shipped source, and
    // `this` is supplied by .call(stub) below.
    const asFunction = body.replace(/^\s*/, '').replace(new RegExp(`^${name}\\(`), `function ${name}(`);
    return (0, eval)(`(${asFunction})`);
};
const dissolveFn = compileMethod('_dissolveBossSummons', game);

const mkGame = (words, projectiles = []) => {
    const g = {
        words,
        projectiles,
        targetedWord: null,
        boss: { color: '#aa00ff' },
        victoryGraceUntil: 0,
        bursts: []
    };
    g.combatSystem = { spawnBurst: (x, y, p) => g.bursts.push([x, y, p]) };
    return g;
};
const mkWord = (isBossAttack, dying = false) => ({
    isBossAttack, dying, x: 10, y: 20,
    elementColors: { particles: ['#00e5ff'] }
});

{
    const g = mkGame([mkWord(true), mkWord(true), mkWord(false)]);
    dissolveFn.call(g);
    const bossWords = g.words.filter((w) => w.isBossAttack);
    const normal = g.words.filter((w) => !w.isBossAttack);
    check("the dead boss's own meteors are marked dying", bossWords.length === 2 && bossWords.every((w) => w.dying));
    check('ordinary words are LEFT on the lane (option A: score/XP flow preserved)',
        normal.length === 1 && normal[0].dying === false);
    check('each dissolved meteor gets its own burst, so the removal reads as an unravel',
        g.bursts.length === 2);
    check('a projectile the dead boss was answering dies with it',
        (() => { const p = { isDead: false }; const g2 = mkGame([], [p]); dissolveFn.call(g2); return p.isDead === true; })());
    check('the targeted word is released if it was a boss summon',
        (() => {
            const w = mkWord(true);
            const g2 = mkGame([w]); g2.targetedWord = w;
            dissolveFn.call(g2);
            return g2.targetedWord === null;
        })());
    check('a word that is already dying is not double-processed',
        (() => { const g2 = mkGame([mkWord(true, true)]); dissolveFn.call(g2); return g2.bursts.length === 0; })());
}
check('the boss death hook is one-shot, so the dissolve cannot re-fire each frame',
    game.includes('if (this.boss.isDead && !this._bossSummonsCleared) {') &&
    game.includes('this._bossSummonsCleared = true;') &&
    (game.match(/this\._bossSummonsCleared = false;/g) || []).length >= 2);
check('no victory-grace invulnerability exists (the owner chose option A only)',
    !game.includes('_inVictoryGrace') && !game.includes('victoryGraceUntil'));

// ── AT-F15: Bloodseeker's netherblade strike rotation ─────────────────────
// The four blades are a LEASE POOL, not four independent spawners. These
// checks run the real Game methods (sliced out of the shipped source and
// executed) so a rotation that silently degrades into "always blade 1" or
// "one blade fires twice" cannot pass.
const leaseSingle = sliceMethod(game, '_leaseBladeSlash');
const leaseVolley = sliceMethod(game, '_leaseBladeVolley');
check('both blade-lease methods exist in the shipped Game', !!leaseSingle && !!leaseVolley);

if (leaseSingle && leaseVolley) {
    // Bind the two REAL shipped methods onto a stand-in game object, so the
    // rotation under test is the production logic and not a re-implementation.
    const mkGame = () => {
        const g = { bladeSlash: { next: 0, leases: [null, null, null, null] } };
        g._leaseBladeSlash = leaseSingle;
        g._leaseBladeVolley = leaseVolley;
        return g;
    };
    const now = performance.now();

    // Four rapid strikes inside the recall window must lease 1→2→3→4.
    const g1 = mkGame();
    const order = [];
    for (let i = 0; i < 4; i++) order.push(g1._leaseBladeSlash(100, 200, 5000));
    check('four rapid strikes rotate strictly through all four blades (1→2→3→4)',
        JSON.stringify(order) === JSON.stringify([0, 1, 2, 3]), JSON.stringify(order));

    // A blade already in flight is never re-leased.
    const g2 = mkGame();
    g2._leaseBladeSlash(0, 0, 5000);
    const second = g2._leaseBladeSlash(0, 0, 5000);
    check('a blade already in flight is not leased again',
        second === 1, `got ${second}`);

    // All four busy → refuse rather than re-firing one.
    const g3 = mkGame();
    for (let i = 0; i < 4; i++) g3._leaseBladeSlash(0, 0, 5000);
    check('a fifth strike with all four blades flying is refused, not double-struck',
        g3._leaseBladeSlash(0, 0, 5000) === -1);

    // An expired lease frees the blade again.
    const g4 = mkGame();
    g4.bladeSlash.leases[0] = { startedAt: now - 900, duration: 400, targetX: 0, targetY: 0 };
    const reused = g4._leaseBladeSlash(0, 0, 400);
    check('an expired (recalled) blade becomes available again', reused === 0, `got ${reused}`);

    // Supernova leases all four at once, and inside the 1 s Blood Moon window.
    const g5 = mkGame();
    g5._leaseBladeSlash(0, 0, 5000);
    g5._leaseBladeVolley(300, 400, 860);
    check('the Supernova volley leases all four blades at once',
        g5.bladeSlash.leases.every(l => l && l.targetX === 300 && l.targetY === 400));
    check('the volley flight finishes before the 1 s Blood Moon cinematic ends',
        g5.bladeSlash.leases.every(l => l.duration <= 1000),
        `${g5.bladeSlash.leases[0].duration}ms`);
}

check('CombatSystem leases a blade per boss strike and volleys on Supernova',
    combat.includes('this.game._leaseBladeSlash?.(boss.x, boss.y + 20);') &&
    combat.includes('this.game._leaseBladeVolley?.(this.game.boss.x, this.game.boss.y + 20);'));

check('the renderer reads the lease and moves a leasing blade off its anchor',
    renderer.includes('stats && stats.bladeSlash && stats.bladeSlash.leases') &&
    renderer.includes('for (let bi = 0; bi < bladeArm.length; bi++)') &&
    renderer.includes('ctx.arc(drawX, drawY'));

// ── AT-F15: the streak must not share the weapon's value ──────────────────
// The streak the player actually sees is `_drawBloodStreak` (the persistent
// oath circle drawn for every tier), NOT the base body's rune ring. Asserting
// only the base body's palette is what let the saturated `#ff1744` streak
// survive a "recolour" and keep merging with the blades.
const bloodBody = renderer.slice(renderer.indexOf('static drawBloodseeker'));
const bloodStreak = renderer.slice(
    renderer.indexOf('static _drawBloodStreak'),
    renderer.indexOf('static draw(ctx')
);
const voidBody = renderer.slice(renderer.indexOf('static drawVoidweaver'),
    renderer.indexOf('static drawBloodseeker'));
check("the Bloodseeker streak is a lighter blood-rose, not the blade's #ff1744",
    bloodBody.includes("const streak = combo >= 50 ? 'rgba(255, 141, 150, 0.95)'") &&
    /strokeStyle = streak;/.test(bloodBody));
check('the persistent blood streak circle is NOT painted in the blade crimson',
    bloodStreak.includes("const crimson = tier >= 4 ? '#ffffff' : '#ffa8b8';") &&
    bloodStreak.includes("const rose = '#ffdde3';") &&
    !/rgba\(255,\s*23,\s*68/.test(bloodStreak) &&
    !/'#ff1744'/.test(bloodStreak),
    bloodStreak.match(/rgba\(255,\s*23,\s*68|'#ff1744'/g)?.join(' ') || '');
check('the blood streak is drawn BRIGHT (thicker boundary, real glow, not a hairline)',
    bloodStreak.includes('ctx.lineWidth = tier >= 4 ? 2.8 : 1.9;') &&
    bloodStreak.includes("ctx.shadowColor = '#ffb3c0';") &&
    bloodStreak.includes('ctx.shadowBlur = 10 + tier * 3;'),
    'a pale-but-thin circle reads as a hairline and never registers as power');
check("the netherblades keep their own deep crimson (the owner called it perfect)",
    bloodBody.includes("ctx.fillStyle = '#ff1744';") &&
    bloodBody.includes("'rgba(255, 23, 68, 0.92)'") &&
    bloodBody.includes("ctx.shadowColor = charging ? '#ff6b88' : '#ff1744';"),
    'the resting blade must still be the deep crimson edge');

// ── AT-F15: the blade IS the Bloodseeker's strike ─────────────────────────
// Regression: the slash used to fire on the Projectile's IMPACT, so the
// character threw an arcane bolt and only slashed when the bolt landed. The
// blade must leave formation the moment the word is solved.
check('the Bloodseeker throws no arcane bullet — the netherblade is the strike',
    input.includes("if (this.game.stats.selectedCharacter !== 'bloodseeker') {") &&
    input.includes('this.game.combatSystem.strikeBoss(word.text.length);'),
    'expected the bloodseeker branch to strike on the word, not on a projectile');
check('the Wizard and Voidweaver still fire their projectile',
    input.includes('this.game.projectiles.push(projectile);') &&
    input.includes('word.text.length)'));
check('the projectile impact path still exists for the other two characters',
    game.includes('this.combatSystem.strikeBoss(proj.wordLength);'));

// The four flight beats. A single dash-out-and-return read as an instant blink,
// which is what the owner reported; the hover/charge beat is the fix, so it is
// pinned here rather than left to a future refactor to quietly collapse back.
check('the blade flight is launch → hover → slash → recall (not one instant dash)',
    renderer.includes('if (p < 0.24) {') &&
    renderer.includes('charging = true;') &&
    renderer.includes('} else if (p < 0.60) {') &&
    renderer.includes('} else if (p < 0.76) {'),
    'expected four distinct beats with a hover/charge hold');
check('the hover overshoots past the boss and trembles (rocket-like station-keeping)',
    renderer.includes('k = 1 + Math.sin(u * Math.PI) * 0.09;') &&
    renderer.includes('const amp = 1.6 + Math.sin((p - 0.24) * 34) * 1.1;'));
check('the recall leg is shorter than the hover hold, so blades re-form quickly',
    (0.60 - 0.24) > (1 - 0.76),
    `hover=${(0.60 - 0.24).toFixed(2)} recall=${(1 - 0.76).toFixed(2)}`);
check('the blade brightens while charging, so the pause reads as anticipation',
    renderer.includes("ctx.shadowColor = charging ? '#ff6b88' : '#ff1744';") &&
    renderer.includes("ctx.strokeStyle = charging ? 'rgba(255, 150, 170, 0.98)'"));
check('the per-word slash is slowed from the original 420ms, and the volley still fits the 1s cinematic',
    game.includes('_leaseBladeSlash(targetX, targetY, duration = 700)') &&
    game.includes('_leaseBladeVolley(targetX, targetY, duration = 960)'),
    'both defaults must be > 420ms and the volley must stay under 1000ms');
check('the Voidweaver streak is a brighter aqua than the wells\' own photon rings',
    voidBody.includes("const hot = combo >= 50 ? '#7cf0ff' : '#4fd8f0';") &&
    voidBody.includes('const warm = combo >= 50 ?') &&
    voidBody.includes("ctx.fillStyle = '#01010a';"));
check('the Voidweaver black-hole wells keep their original deep colours',
    voidBody.includes("rgba(0, 229, 255, 0.9)") &&
    voidBody.includes("rgba(124, 77, 255, 0.6)"));

if (failures) {
    console.error(`${failures} Arena VFX hierarchy check(s) FAILED.`);
    process.exit(1);
}
console.log('All Arena VFX hierarchy checks passed.');
