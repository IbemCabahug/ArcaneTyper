export const PERFORMANCE_KEY = 'typerMaster_performanceOptimization';

// User preference is authoritative: FPS monitoring must never overwrite it.
export class VisualQuality {
    constructor(storage, target = {}) {
        this.storage = storage;
        this.target = target;
        this.enabled = false;
        try { this.enabled = storage?.getItem(PERFORMANCE_KEY) === 'true'; } catch (_) {}
        this.apply();
    }

    apply() {
        // Compatibility bridge for existing selective glow/particle branches.
        this.target.__atLowQuality = this.enabled;
    }

    setEnabled(enabled) {
        this.enabled = enabled === true;
        this.apply();
        try { this.storage?.setItem(PERFORMANCE_KEY, String(this.enabled)); } catch (_) {}
    }

    get particleBudget() { return this.enabled ? 160 : 400; }
    get explosionScale() { return this.enabled ? 0.5 : 1; }
}

let storage;
try { storage = globalThis.localStorage; } catch (_) {}
export const visualQuality = new VisualQuality(storage, globalThis);