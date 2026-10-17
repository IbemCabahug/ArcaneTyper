import { createServer } from '../frontend/node_modules/vite/dist/node/index.js';
import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * scripts/profile-scenes.mjs
 *
 * Automated scene profiling harness for Arcane Typer.
 * Spins up a local Vite instance, launches headless Chromium, and benchmarks
 * canvas draw frame times (mean, p95, max) across 5 heavy scenarios
 * with Performance Optimization (window.__atLowQuality) OFF vs ON.
 */

const server = await createServer({
    root: fileURLToPath(new URL('../frontend/', import.meta.url)),
    server: { port: 0, host: '127.0.0.1' }
});

let browser;

try {
    await server.listen();
    const port = server.httpServer.address().port;
    const url = `http://127.0.0.1:${port}`;

    const executablePath = process.env.BROWSER_PATH || [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ].find(existsSync);

    browser = await puppeteer.launch({
        headless: true,
        timeout: 8000,
        ...(executablePath ? { executablePath } : {})
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(30000);

    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.setRequestInterception(true);
    page.on('request', req => {
        if (req.url().startsWith('http://127.0.0.1:') || req.url().startsWith('data:')) {
            req.continue();
        } else {
            req.abort();
        }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.game && window.game.canvas);

    console.log('=== Arcane Typer Scene Profiling Benchmark ===\n');

    const results = await page.evaluate(async () => {
        const game = window.game;
        const ctx = game.ctx;
        const W = game.canvas.width;
        const H = game.canvas.height;

        function runBenchmark(setupFn, frameCount = 120) {
            setupFn();
            const times = [];
            // Warm-up 10 frames
            for (let i = 0; i < 10; i++) {
                ctx.clearRect(0, 0, W, H);
                game.draw();
            }
            // Measured frames
            for (let i = 0; i < frameCount; i++) {
                ctx.clearRect(0, 0, W, H);
                const t0 = performance.now();
                game.draw();
                const t1 = performance.now();
                times.push(t1 - t0);
            }
            times.sort((a, b) => a - b);
            const sum = times.reduce((acc, v) => acc + v, 0);
            const mean = sum / times.length;
            const median = times[Math.floor(times.length * 0.5)];
            const p95 = times[Math.floor(times.length * 0.95)];
            const max = times[times.length - 1];
            return { mean, median, p95, max };
        }

        const scenarios = [
            {
                name: '1. Wizard at 200+ Combo (Mandala + Armillary)',
                setup: () => {
                    game.gameMode = 'classic';
                    game.stats.selectedCharacter = 'wizard';
                    game.stats.combo = 200;
                    game.stats.mana = 100;
                    game.isBossPhase = false;
                }
            },
            {
                name: '2. Voidweaver at 200+ Combo (Abyss + Wells)',
                setup: () => {
                    game.gameMode = 'classic';
                    game.stats.selectedCharacter = 'voidweaver';
                    game.stats.combo = 200;
                    game.stats.mana = 100;
                    game.isBossPhase = false;
                    const now = performance.now();
                    game.voidWells = {
                        next: 0,
                        leases: [
                            { startedAt: now, duration: 2000, targetX: W * 0.3, targetY: H * 0.4 },
                            { startedAt: now - 300, duration: 2000, targetX: W * 0.7, targetY: H * 0.5 },
                            null,
                            null
                        ]
                    };
                }
            },
            {
                name: '3. Bloodseeker at 200+ Combo (Ready Blood Moon)',
                setup: () => {
                    game.gameMode = 'classic';
                    game.stats.selectedCharacter = 'bloodseeker';
                    game.stats.combo = 200;
                    game.stats.mana = 100;
                    game.isBossPhase = false;
                    game.voidWells = null;
                }
            },
            {
                name: '4. 1v1 Arena Duel (Overlapping Sigils + Team Auras)',
                setup: () => {
                    game.gameMode = 'duel';
                    game.duelSide = 'A';
                    game.stats.selectedCharacter = 'wizard';
                    game.duelOpponent = { character: 'voidweaver', name: 'Opponent' };
                    game.duelCombos = { A: 120, B: 110 };
                    game.duelCharacters = { A: 'wizard', B: 'voidweaver' };
                    const now = Date.now();
                    game.duelAuras = { A: 'cinder-brand', B: 'crushing-gravity' };
                    game.duelBuffUntil = { A: now + 5000, B: now + 5000 };
                    game.duelTimeStopUntil = 0;
                }
            },
            {
                name: '5. Barrier Break Burst (Shockwave + Glass Shards)',
                setup: () => {
                    game.gameMode = 'classic';
                    game.stats.selectedCharacter = 'wizard';
                    game.stats.combo = 0;
                    for (let k = 0; k < 3; k++) {
                        game.triggerBarrierBreakEffect();
                    }
                }
            }
        ];

        const output = [];

        for (const sc of scenarios) {
            window.__atLowQuality = false;
            const offMetrics = runBenchmark(sc.setup, 100);

            window.__atLowQuality = true;
            const onMetrics = runBenchmark(sc.setup, 100);

            output.push({
                name: sc.name,
                off: offMetrics,
                on: onMetrics
            });
        }

        return output;
    });

    for (const r of results) {
        console.log(`Scenario: ${r.name}`);
        console.log(`  Normal (LowQ OFF)   : Mean ${r.off.mean.toFixed(3)}ms | p95 ${r.off.p95.toFixed(3)}ms | Max ${r.off.max.toFixed(3)}ms`);
        console.log(`  Optimized (LowQ ON) : Mean ${r.on.mean.toFixed(3)}ms | p95 ${r.on.p95.toFixed(3)}ms | Max ${r.on.max.toFixed(3)}ms`);
        const delta = ((r.on.mean - r.off.mean) / r.off.mean * 100).toFixed(1);
        console.log(`  Current Difference  : ${delta}% frame time\n`);
    }

} finally {
    await browser?.close();
    await server.close();
}
