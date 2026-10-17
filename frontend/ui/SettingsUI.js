import { visualQuality } from '../VisualQuality.js';

// Native modal owns focus/inertness; local listeners keep settings keys and
// taps away from gameplay and the hidden mobile keyboard bridge.
export function initSettingsUI() {
    const dialog = document.getElementById('settings-dialog');
    const toggle = document.getElementById('performance-optimization');
    const open = () => {
        toggle.checked = visualQuality.enabled;
        if (!dialog.open) dialog.showModal();
    };
    document.getElementById('open-settings-btn').addEventListener('click', open);
    document.getElementById('pause-settings-btn').addEventListener('click', open);
    document.getElementById('close-settings-btn').addEventListener('click', () => dialog.close());
    toggle.addEventListener('change', () => visualQuality.setEnabled(toggle.checked));
    for (const event of ['keydown', 'click', 'touchstart']) {
        dialog.addEventListener(event, e => e.stopPropagation());
    }
}