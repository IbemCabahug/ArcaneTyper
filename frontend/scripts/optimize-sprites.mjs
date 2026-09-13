import Jimp from 'jimp';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// One-off: downscale the (huge) element sprite strips so browsers decode and
// scale them cheaply on slow devices. Originals (0.8-1 MB each) are replaced
// in place; git preserves the old versions. Run:  node scripts/optimize-sprites.mjs
const TARGET_WIDTH = 160; // display size is ~40-90 px; no quality is lost

const __dir = dirname(fileURLToPath(import.meta.url));
const files = ['fire.png', 'ice.png', 'lightning.png', 'void.png'];

for (const name of files) {
    const path = resolve(__dir, `../public/${name}`);
    try {
        const image = await Jimp.read(path);
        const w = image.bitmap.width;
        const h = image.bitmap.height;
        if (w <= TARGET_WIDTH) {
            console.log(`skip ${name} (already ${w}x${h})`);
            continue;
        }
        const scale = TARGET_WIDTH / w;
        const nh = Math.round(h * scale);
        image.resize(TARGET_WIDTH, nh);
        await image.writeAsync(path);
        console.log(`optimized ${name}: ${w}x${h} -> ${TARGET_WIDTH}x${nh}`);
    } catch (e) {
        console.error(`FAILED ${name}:`, e.message);
    }
}
console.log('sprite optimization done');