import assert from 'node:assert/strict';
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js';
import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Uses already-installed local browser tooling; never contacts the game backend.
const server = await createServer({ root: fileURLToPath(new URL('../frontend/', import.meta.url)), server: { port: 0, host: '127.0.0.1' } });
let browser;
try {
    await server.listen();
    const executablePath = process.env.BROWSER_PATH || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
    browser = await puppeteer.launch({ headless: true, timeout: 8000, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    page.setDefaultNavigationTimeout(8000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', request => request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('data:') ? request.continue() : request.abort());
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.game);
    // Auth is unrelated: expose the normal dashboard button without logging in.
    await page.evaluate(() => { document.getElementById('open-settings-btn').click(); });
    await page.waitForSelector('#settings-dialog[open]');
    await page.click('#performance-optimization');
    assert.equal(await page.evaluate(() => window.__atLowQuality), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.$('#settings-dialog[open]'), null);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.game);
    assert.equal(await page.evaluate(() => window.__atLowQuality), true);
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluate(() => document.getElementById('pause-settings-btn').click());
    await page.waitForSelector('#settings-dialog[open]');
    const fits = await page.$eval('#settings-dialog', el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
    assert.equal(fits, true);
    await page.click('#performance-optimization');
    assert.equal(await page.evaluate(() => window.__atLowQuality), false);
    assert.deepEqual(errors, []);
    console.log('PASS Chromium: dialog, Escape, persisted toggle, mobile layout, no page exceptions');
} finally {
    await browser?.close();
    await server.close();
}