/**
 * RenderCache — bakes expensive-to-paint patterns into small offscreen
 * canvases once, then serves them back per frame as cheap drawImage calls.
 *
 * Canvas 2D is fast at blitting bitmaps and slow at recomputing paths,
 * gradients and (above all) shadowBlur. Every pattern here is either fully
 * static or changes rarely (wand color, character select), so painting it
 * once costs nothing at runtime.
 */
export class RenderCache {
    static _store = new Map();

    static get(key) {
        return this._store.get(key);
    }

    static has(key) {
        return this._store.has(key);
    }

    /**
     * Return a cached canvas for `key`, or build it with `drawFn` once.
     * drawFn(ctx, canvas) does the expensive painting; shadowBlur used here
     * is paid exactly once and becomes plain pixels afterwards.
     */
    static bake(key, w, h, drawFn) {
        const cached = this._store.get(key);
        if (cached) return cached;
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.ceil(w));
        c.height = Math.max(1, Math.ceil(h));
        const ctx = c.getContext('2d');
        drawFn(ctx, c);
        this._store.set(key, c);
        return c;
    }

    static invalidate(prefix) {
        for (const key of this._store.keys()) {
            if (key.startsWith(prefix)) this._store.delete(key);
        }
    }

    static clear() {
        this._store.clear();
    }
}