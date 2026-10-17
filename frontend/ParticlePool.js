import { Particle } from './Particle.js';
import { visualQuality } from './VisualQuality.js';

/**
 * ParticlePool — Zero-allocation particle manager for ArcaneTyper.
 *
 * Pre-allocates a fixed pool of Particle instances to completely eliminate
 * garbage collection pauses (GC freezes) from runtime instantiations
 * and array splicing inside the 60 FPS update loop.
 */
export class ParticlePool {
    constructor(maxParticles = 350) {
        this.maxParticles = maxParticles;
        this.pool = [];
        for (let i = 0; i < maxParticles; i++) {
            const p = new Particle();
            p.active = false;
            this.pool.push(p);
        }
        this._activeCount = 0;
    }

    get length() {
        return this._activeCount;
    }

    /**
     * Spawns or recycles a particle at (x, y) with the specified color/config.
     */
    spawn(x, y, color) {
        this._trimToBudget();
        const budget = Math.min(this.maxParticles, visualQuality.particleBudget);
        // 1. Find the first inactive particle
        for (let i = 0; i < this.maxParticles; i++) {
            const p = this.pool[i];
            if (!p.active && this._activeCount < budget) {
                p.init(x, y, color);
                this._activeCount++;
                return p;
            }
        }

        // 2. Pool exhausted: Recycle the oldest / lowest life particle
        let lowestLifeIndex = 0;
        let minLife = 999;
        for (let i = 0; i < this.maxParticles; i++) {
            if (this.pool[i].active && this.pool[i].life < minLife) {
                minLife = this.pool[i].life;
                lowestLifeIndex = i;
            }
        }

        const recycled = this.pool[lowestLifeIndex];
        recycled.init(x, y, color);
        return recycled;
    }

    /**
     * Backward-compatible push method for existing call sites.
     */
    push(item) {
        if (!item) return;
        if (item.active) {
            // Already initialized particle instance
            this._activeCount++;
            return;
        }
        // If someone passes a newly constructed Particle, copy its state into an available pool slot
        this.spawn(item.x, item.y, item.color);
    }

    /**
     * Shift method for recycling oldest particle (used in CombatSystem.spawnExplosion)
     */
    shift() {
        for (let i = 0; i < this.maxParticles; i++) {
            if (this.pool[i].active) {
                this.pool[i].active = false;
                this._activeCount = Math.max(0, this._activeCount - 1);
                return this.pool[i];
            }
        }
        return null;
    }

    update(dt) {
        this._trimToBudget();
        let active = 0;
        for (let i = 0; i < this.maxParticles; i++) {
            const p = this.pool[i];
            if (p.active) {
                p.update(dt);
                if (p.life <= 0 || !p.active) {
                    p.active = false;
                } else {
                    active++;
                }
            }
        }
        this._activeCount = active;
    }

    draw(ctx) {
        for (let i = 0; i < this.maxParticles; i++) {
            const p = this.pool[i];
            if (p.active && p.life > 0) {
                p.draw(ctx);
            }
        }
    }

    _trimToBudget() {
        const budget = Math.min(this.maxParticles, visualQuality.particleBudget);
        if (this._activeCount <= budget) return;
        // Retain the newest live effects when switching profiles mid-scene.
        const active = this.pool.filter(p => p.active).sort((a, b) => a.life - b.life);
        for (const p of active) {
            if (this._activeCount <= budget) break;
            p.active = false;
            p.life = 0;
            this._activeCount--;
        }
    }

    forEach(callback) {
        for (let i = 0; i < this.maxParticles; i++) {
            const p = this.pool[i];
            if (p.active && p.life > 0) {
                callback(p);
            }
        }
    }

    clear() {
        for (let i = 0; i < this.maxParticles; i++) {
            this.pool[i].active = false;
            this.pool[i].life = 0;
        }
        this._activeCount = 0;
    }
}
