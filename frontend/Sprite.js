export class Sprite {
    // Module-level cache: the void-element flood fill (removeOuterBlack) is a
    // full-image pixel walk done synchronously on the main thread. Previously
    // it re-ran on EVERY void-word spawn (new Sprite -> new Image -> onload),
    // causing a large hitch each time. The processed result is identical per
    // source URL, so compute it once and share it.
    static _processedCache = new Map();

    constructor(imageSrc, frames = 0, ticksPerFrame = 5, scale = 1.0, elementName = '') {
        this.image = new Image();
        this.image.src = imageSrc;
        this.elementName = elementName || (imageSrc.includes('void') ? 'void' : '');

        this.frames = frames; // If 0, we'll auto-calculate it after the image loads
        this.ticksPerFrame = ticksPerFrame;
        this.scale = scale;

        this.frameIndex = 0;
        this.tickCount = 0;
        this.isLoaded = false;

        this.frameWidth = 0;
        this.frameHeight = 0;
        this.processedImage = null;

        this.image.onload = () => {
            this.isLoaded = true;
            // Intended layout: a horizontal strip of SQUARE frames, each
            // frameHeight tall. The bundled art is single-frame (w != h), in
            // which case the strip is NOT tiled and must be treated as one
            // frame spanning its full width — the old code assumed a
            // width=height tiling and drew a 1024px-wide source rect from a
            // 590px-wide image (stretched glitch).
            const isSquareTiling = this.image.width >= this.image.height;
            this.frameHeight = this.image.height;
            this.frameWidth = isSquareTiling ? this.image.height : this.image.width;

            if (this.frames === 0) {
                // Auto-calculate frame count (1 for non-tiled strips)
                this.frames = Math.max(1, Math.floor(this.image.width / this.frameWidth));
            }

            if (this.elementName === 'void') {
                const cached = Sprite._processedCache.get(imageSrc);
                if (cached) {
                    this.processedImage = cached;
                } else {
                    this.processedImage = this.removeOuterBlack(this.image);
                    Sprite._processedCache.set(imageSrc, this.processedImage);
                }
            } else {
                this.processedImage = this.image;
            }
        };
    }

    removeOuterBlack(image) {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        const w = Math.floor(canvas.width);
        const h = Math.floor(canvas.height);
        const stack = [];

        // threshold for "black", strict to not clip dark greens
        const threshold = 15;

        const isBlack = (x, y) => {
            const i = (y * w + x) * 4;
            if (data[i + 3] === 0) return false;
            return data[i] <= threshold && data[i + 1] <= threshold && data[i + 2] <= threshold;
        };

        // Push edges
        for (let x = 0; x < w; x++) {
            if (isBlack(x, 0)) stack.push(x, 0);
            if (isBlack(x, h - 1)) stack.push(x, h - 1);
        }
        for (let y = 0; y < h; y++) {
            if (isBlack(0, y)) stack.push(0, y);
            if (isBlack(w - 1, y)) stack.push(w - 1, y);
        }

        while (stack.length > 0) {
            const y = stack.pop();
            const x = stack.pop();

            const i = (y * w + x) * 4;
            if (data[i + 3] === 0) continue; // Already processed

            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 0; // alpha = 0

            if (x + 1 < w && isBlack(x + 1, y)) stack.push(x + 1, y);
            if (x - 1 >= 0 && isBlack(x - 1, y)) stack.push(x - 1, y);
            if (y + 1 < h && isBlack(x, y + 1)) stack.push(x, y + 1);
            if (y - 1 >= 0 && isBlack(x, y - 1)) stack.push(x, y - 1);
        }

        ctx.putImageData(imageData, 0, 0);
        return canvas;
    }

    update() {
        if (!this.isLoaded || this.frames <= 1) return;

        this.tickCount += 1;
        if (this.tickCount > this.ticksPerFrame) {
            this.tickCount = 0;
            this.frameIndex = (this.frameIndex + 1) % this.frames;
        }
    }

    draw(ctx, x, y, targetWidth = null, elementName = 'fire', angle = 0) {
        if (!this.isLoaded) return;

        // If targetWidth is provided, calculate the scale needed to cover it exactly.
        // Multiply by 1.2 to give a gentle padding around the text so the spell fully swallows the word.
        let currentScale = this.scale;

        if (targetWidth !== null && this.frameWidth > 0) {
            currentScale = (targetWidth / this.frameWidth) * 1.5; // 150% of the word width to look like a true aura
        }

        ctx.save();
        // For void, we use source-over because we removed the outer black dynamically.
        // For others, we use screen to remove black backgrounds.
        ctx.globalCompositeOperation = elementName === 'void' ? 'source-over' : 'screen';

        // Translate to the exact center in order to apply rotation accurately around its pivot
        ctx.translate(x, y);
        ctx.rotate(angle);

        const imageSource = this.processedImage || this.image;

        ctx.drawImage(
            imageSource,
            this.frameIndex * this.frameWidth,
            0,
            this.frameWidth,
            this.frameHeight,
            - (this.frameWidth * currentScale) / 2, // Centered X around 0,0 locally
            - (this.frameHeight * currentScale) / 2, // Centered Y around 0,0 locally
            this.frameWidth * currentScale,
            this.frameHeight * currentScale
        );

        ctx.restore();
    }
}
