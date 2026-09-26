export class MagicalToast {
    static init() {
        this.toastContainer = document.getElementById('toast-container');

        // Add Esc listener to dismiss toasts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.clearAll();
            }
        });
    }

    static show(message, duration = 4000) {
        if (!this.toastContainer) return;

        const toast = document.createElement('div');
        toast.className = 'magical-toast';
        toast.innerHTML = message;

        this.toastContainer.appendChild(toast);

        // Auto-remove after duration
        setTimeout(() => {
            toast.classList.add('fade-out');
            // Remove from DOM after transition finishes
            setTimeout(() => {
                if (this.toastContainer && this.toastContainer.contains(toast)) {
                    this.toastContainer.removeChild(toast);
                }
            }, 500);
        }, duration);
    }

    /**
     * The "this needs a sealed Mage Card" prompt — used by every entitlement
     * gate (Forge / Workshop / Arena).
     *
     * Owner request 2026-09-26: fancier and snappier than a plain toast. It is
     * deliberately its own variant rather than a restyled `.magical-toast`:
     * a gate is a *question* the player must answer, so it wears a lock glyph,
     * an accent headline and a clear action line, and it lives for less time
     * (3.4s vs 4s) because it is not news — it is a prompt.
     *
     * `headline`/`body` are passed separately (not pre-joined with `<br>`) so
     * the visual hierarchy lives in ONE place here instead of being
     * re-improvised as inline styles at each of the three call sites.
     */
    static locked(headline, body, duration = 3400) {
        this.show(
            `<div class="toast-gate__head">${headline}</div>` +
            `<div class="toast-gate__sub">${body}</div>`,
            duration
        );
        // Tag the node that was just appended so the fancy treatment is scoped
        // to the gate. `show()` appends synchronously, so lastElementChild is
        // this toast and not a leftover one.
        const node = this.toastContainer && this.toastContainer.lastElementChild;
        if (node) node.classList.add('magical-toast--gate');
    }

    static clearAll() {
        if (!this.toastContainer) return;
        const toasts = this.toastContainer.querySelectorAll('.magical-toast');
        toasts.forEach(toast => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                if (this.toastContainer && this.toastContainer.contains(toast)) {
                    this.toastContainer.removeChild(toast);
                }
            }, 500);
        });
    }
}
