import { Word } from './Word.js';
import { Sprite } from './Sprite.js';

export class BossWord extends Word {
    constructor(text, canvasWidth, canvasHeight, speedMultiplier, targetX, targetY, elementType = 'fire') {
        super(text, canvasWidth, canvasHeight, speedMultiplier, targetX, targetY);

        // Core Boss Properties
        this.isBoss = true;
        this.elementType = elementType;

        // Visual setup for the multi-element mechanic
        this.segments = text.split('-');
        this.currentSegmentIndex = 0;

        // Element sequences are now locked to the Boss's main element
        this.elementSequence = [];
        for (let i = 0; i < this.segments.length; i++) {
            this.elementSequence.push(this.elementType);
        }

        this.applyCurrentElement();

        // Speed modifications based on boss element
        let speedMod = 0.25; // Default slow down
        let scaleMod = 0;

        switch (this.elementType) {
            case 'ice':
                speedMod = 0.15; // Extremely slow
                scaleMod = 0.5; // Huge
                break;
            case 'thunder':
                speedMod = 0.45; // Faster
                break;
            case 'fire':
                speedMod = 0.30;
                break;
            case 'dark':
                speedMod = 0.25;
                break;
        }

        this.speed = this.speed * speedMod;
        this.vx = this.vx * speedMod;
        this.vy = this.vy * speedMod;

        // Scale it up
        this.scale = 1.3 + scaleMod + Math.random() * 0.3;
    }

    applyCurrentElement() {
        this.elementName = this.elementSequence[this.currentSegmentIndex];
        this.elementColors = Word.ELEMENTS[this.elementName];

        // Map boss elements to sprite definitions
        const sprintElementMap = {
            'fire': 'fire',
            'ice': 'ice',
            'thunder': 'lightning',
            'dark': 'void'
        };

        const mappedEle = sprintElementMap[this.elementName] || 'fire';

        const spriteMap = {
            'fire': '/fire.png',
            'ice': '/ice.png',
            'lightning': '/lightning.png',
            'void': '/void.png'
        };

        const spriteSrc = spriteMap[mappedEle];
        if (spriteSrc) {
            this.sprite = new Sprite(spriteSrc, 0, 5, 2.5, mappedEle);
        }
    }

    // Override typeLetter to check for segment completion
    // Returns { correct: boolean, segmentComplete: boolean }
    typeBossLetter(letter) {
        if (this.untyped[0] === letter) {
            this.typed += letter;
            this.untyped = this.untyped.slice(1);

            // Check if we just typed a hyphen (meaning we completed a segment)
            // or if we finished the entire word
            if (letter === '-' && this.untyped.length > 0) {
                this.currentSegmentIndex++;
                this.applyCurrentElement(); // Shift visual element immediately
                return { correct: true, segmentComplete: true };
            }

            return { correct: true, segmentComplete: false };
        }
        return { correct: false, segmentComplete: false };
    }

    draw(ctx) {
        if (this.isDead) return;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(this.scale, this.scale);

        // Intimidating red shadow always present for boss, gold if targeted
        ctx.shadowColor = this.isTargeted ? 'rgba(255, 215, 0, 0.9)' : 'rgba(255, 0, 0, 0.6)';
        ctx.shadowBlur = window.__atLowQuality ? 0 : (this.isTargeted ? 20 : 10);

        ctx.font = 'bold 32px Cinzel, serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        if (this._lastTypedStr !== this.typed) {
            this._cachedTypedWidth = ctx.measureText(this.typed).width;
            this._lastTypedStr = this.typed;
        }

        const textYOffset = 70;
        const textXOffset = -35;
        const startX = (-this.totalTextWidth / 2) + textXOffset;

        if (this.sprite) {
            // Boss sprites are slightly wider/larger
            this.sprite.draw(ctx, 0, -20, this.spriteTargetWidth * 1.2, this.elementName, this.angle);
        }

        // Draw typed part
        ctx.fillStyle = this.isTargeted ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.4)';
        ctx.fillText(this.typed, startX, textYOffset);

        // Draw untyped part
        // Always red/glowing for boss if untargeted, gold if targeted
        ctx.fillStyle = this.isTargeted ? '#ffd700' : '#ff4b4b';
        ctx.fillText(this.untyped, startX + this._cachedTypedWidth, textYOffset);

        ctx.restore();
    }
}
