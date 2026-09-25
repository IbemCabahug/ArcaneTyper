/**
 * AT-F17 Arena VFX hierarchy guard.
 *
 * The class active is the primary focal effect around a mage. The endless
 * combo remains a readable secondary aura, but an armed active must not allow
 * the Archmage's 150/200 visual tiers to overtake the sigil. The Chronomancer
 * Time Stop seal remains centered and its outer arc remains the expiry clock.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const game = read('frontend/Game.js');
const renderer = read('frontend/game/CharacterRenderer.js');
const sigils = read('frontend/game/ArenaSigils.js');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
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
check('the active sigil is painted before the mage sprite, keeping the body readable',
    game.indexOf('this._drawDuelAuras(frozen);') < game.indexOf('this._drawTeamMage('));

if (failures) {
    console.error(`${failures} Arena VFX hierarchy check(s) FAILED.`);
    process.exit(1);
}
console.log('All Arena VFX hierarchy checks passed.');
