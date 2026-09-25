/**
 * AT-M12 — ordinary Survival word expiry must not consume barrier/life state.
 *
 * The collision loop in Game.js has two ordinary-word failure paths: reaching
 * the mage and drifting off-screen. Both reset the combo and show feedback,
 * but only an explicit boss attack (word.isBossAttack) may call loseLife().
 * This guard prevents a future refactor from merging miss handling back into
 * the damage path.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameSrc = readFileSync(join(root, 'frontend/Game.js'), 'utf8').replace(/\r\n/g, '\n');
const updateStart = gameSrc.indexOf('        for (let i = this.words.length - 1; i >= 0; i--) {');
const updateEnd = gameSrc.indexOf('        // Update particles via ParticlePool', updateStart);
const collision = gameSrc.slice(updateStart, updateEnd);

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}

check('the ordinary collision path is explicitly guarded by isBossAttack',
    collision.includes('if (word.isBossAttack)') &&
    collision.includes('An ordinary word that reaches the mage is a typing'));
check('the off-screen path has the same boss-only life-loss guard',
    collision.includes('A word that drifts off-screen is also a missed typing') &&
    collision.includes('if (word.isBossAttack)'));
check('ordinary misses still reset combo and show feedback',
    (collision.match(/this\.stats\.combo = 0;/g) || []).length >= 2 &&
    (collision.match(/STREAK BROKEN/g) || []).length >= 2 &&
        !collision.includes('Word Missed') &&
        !collision.includes('METEOR STRIKE') && !collision.includes('METEOR MISSED'));
check('every meteor reaching the character uses the defense-impact branch',
    collision.includes('if (word.meteor)') &&
    collision.includes('const defense = this.stats.consumeSurvivalDefense();') &&
    collision.includes("'SHIELD BROKEN'") && collision.includes("'ABSORPTION −1'"));
check('only boss damage uses the character-aware defense transition inside the collision loop',
    (collision.match(/this\.stats\.consumeSurvivalDefense\(\);/g) || []).length === 2 &&
    !collision.includes('this.stats.loseLife();') &&
    collision.includes('const defense = this.stats.consumeSurvivalDefense();'));
check('the impact labels distinguish Wizard shields, Voidweaver absorption, and Bloodseeker lives',
    collision.includes("'SHIELD BROKEN'") &&
    collision.includes("'ABSORPTION −1'") &&
    collision.includes("'LIFE LOST'") &&
    !collision.includes('METEOR STRIKE') && !collision.includes('METEOR MISSED'));
check('the barrier break effect remains tied to boss damage',
    (collision.match(/this\.triggerBarrierBreakEffect\(\);/g) || []).length === 2 &&
    collision.includes("defense.mode === 'barriers'"));

if (failures) process.exit(1);
console.log('All AT-M12 Survival word-loss checks passed.');
