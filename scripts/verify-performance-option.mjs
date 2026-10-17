import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VisualQuality, visualQuality, PERFORMANCE_KEY } from '../frontend/VisualQuality.js';
import { ParticlePool } from '../frontend/ParticlePool.js';

const values = new Map();
const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
const target = {};
const quality = new VisualQuality(storage, target);
assert.equal(quality.enabled, false);
quality.setEnabled(true);
assert.equal(target.__atLowQuality, true);
assert.equal(new VisualQuality(storage).enabled, true);
quality.setEnabled(false);
assert.equal(new VisualQuality(storage).enabled, false);
values.set(PERFORMANCE_KEY, 'corrupt');
assert.equal(new VisualQuality(storage).enabled, false);
const blocked = new VisualQuality({ getItem() { throw Error(); }, setItem() { throw Error(); } });
blocked.setEnabled(true);
assert.equal(blocked.enabled, true);
console.log('PASS preference defaults, persistence, corrupt and blocked storage');

visualQuality.setEnabled(false);
const pool = new ParticlePool(400);
for (let i = 0; i < 500; i++) pool.spawn(0, 0, '#ffffff');
assert.equal(pool.length, 400);
visualQuality.setEnabled(true);
for (let i = 0; i < 500; i++) pool.spawn(0, 0, '#ffffff');
assert.equal(pool.length, 160);
assert.equal(pool.pool.filter(p => p.active).length, 160);
visualQuality.setEnabled(false);
for (let i = 0; i < 400; i++) pool.spawn(0, 0, '#ffffff');
assert.equal(pool.length, 400);
console.log('PASS bounded overlapping particles and restoration');

const game = readFileSync(new URL('../frontend/Game.js', import.meta.url), 'utf8');
assert.doesNotMatch(game, /window\.__atLowQuality\s*=/);
assert.doesNotMatch(game, /lowQ \? 24 : 32|lowQ \? 12 : 15/);
assert.match(game, /sampleElapsed > 0/);
const html = readFileSync(new URL('../frontend/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/style.css', import.meta.url), 'utf8');
for (const id of ['settings-dialog', 'open-settings-btn', 'pause-settings-btn', 'performance-optimization']) {
    assert.equal(html.split(`id="${id}"`).length - 1, 1);
}
const floatingActions = html.slice(html.indexOf('id="start-menu-floating-actions"'), html.indexOf('id="patch-board-menu"'));
assert.doesNotMatch(floatingActions, /id="open-settings-btn"/);
assert.match(floatingActions, /id="open-achievements-icon-btn"/);
assert.match(floatingActions, /id="open-patch-board-btn"/);
assert.match(html, /<button id="open-settings-btn"[^>]*>\s*<svg\b/);
assert.match(css, /#open-settings-btn\s*\{[^}]*position:\s*absolute[^}]*top:\s*20px[^}]*left:\s*24px/s);
console.log('PASS single settings controls, top-left placement, balanced bottom bar, readable text and authoritative preference');