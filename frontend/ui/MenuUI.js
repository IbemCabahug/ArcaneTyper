export class MenuUI {
    constructor(game, startMenu) {
        this.game = game;
        this.startMenu = startMenu;

        // Patch Board Elements
        this.patchBoardMenu = document.getElementById('patch-board-menu');
        this.openPatchBoardBtn = document.getElementById('open-patch-board-btn');
        this.closePatchBoardBtn = document.getElementById('close-patch-board-btn');
        this.patchNotesContainer = document.getElementById('patch-notes-container');

        this.patchNotes = [
            {
                version: "v2.3.2",
                date: "September 23, 2026",
                desc: "Cloud Score History Repaired",
                changes: [
                    "Fixed: your Recent Runs score history now genuinely saves to the cloud — a database permission gap had been silently rejecting every run write since launch; this completes the cloud-saves fix promised in v2.3.1.",
                    "Fixed: writes the database refuses (instead of a lost connection) are now queued and retried automatically instead of being dropped — a repair made on our side recovers them.",
                    "Security: score history can only be written under your own account — forged entries under another mage's name are rejected by the database."
                ]
            },
            {
                version: "v2.3.1",
                date: "September 23, 2026",
                desc: "Reliable Cloud Saves & Refresh-Proof Runs",
                changes: [
                    "Fixed: account progress (XP, level, skills, wand, Hall of Fame) now genuinely saves to the cloud — a database mismatch had been quietly discarding every save.",
                    "Fixed: your score history (Recent Runs) now writes to the cloud on every finished run.",
                    "New: refreshing or closing the tab mid-run no longer eats your run — the score you were holding is banked like a finish (best score, XP, score history, and the Hall of Fame if it qualifies). A toast confirms it on your next load.",
                    "New: an on-screen chip now warns you when the cloud is unreachable or when progress is waiting to sync, instead of failing silently.",
                    "Fixed: runs and progress made during a connection drop are queued locally and sync automatically when the cloud is back."
                ]
            },
            {
                version: "v2.3.0",
                date: "September 13, 2026",
                desc: "Code Health & Security Release",
                changes: [
                    "Security: the hidden admin test mode now requires a real, logged-in account named exactly \"admin\" — guest names no longer unlock anything.",
                    "New: Mage Profile now shows a WPM History chart of your last 10 runs (works offline and for guests).",
                    "Fixed: XP economy — levels were inflating mid-session and dropping after reload; XP is now granted exactly once per run.",
                    "Fixed: Practice (Scribe's Trial) sometimes rendered completely invisible words due to a duplicated hidden screen element.",
                    "Fixed: a duplicate hidden input element that risked breaking mobile typing.",
                    "New: Escape now pauses the Arena (Resume or return to menu; paused during boss fights and duels).",
                    "New: progressive waves — every 30 seconds or 12 words, the assault intensifies (WAVE N announced in the HUD).",
                    "New: press Enter on the main menu to instantly start a run.",
                    "Improved: the codebase was split into clean modules (game engine, UI, backend services) for faster, safer updates."
                ]
            },
            {
                version: "v2.2.6",
                date: "March 15, 2026",
                desc: "Mobile Responsiveness Overhaul",
                changes: [
                    "CRITICAL FIX: Mobile typing was completely broken — keystrokes on touch keyboards were silently ignored. Now fully fixed.",
                    "Fixed: Start Menu now scrolls correctly on small phones instead of cutting off the top content.",
                    "Fixed: Spellbook dropdown no longer overlaps the ArcaneTyper title on narrow screens.",
                    "Fixed: Scribe's Trial results screen no longer overflows the screen edge on phones (iPhone SE, etc.).",
                    "Fixed: Scribe mode header now stacks vertically on narrow screens instead of collapsing.",
                    "Fixed: Game HUD stat-boxes now wrap into two rows on narrow phones for better readability.",
                    "Fixed: Mobile Nova button now respects iPhone notch/home-bar safe-area and only appears during gameplay.",
                    "Improved: App now uses dynamic viewport height (dvh) to fix browser navigation bar overlap on iOS/Android."
                ]
            },
            {
                version: "v2.2.5",
                date: "March 14, 2026",
                desc: "UI Bug Fixes & Overlay Refinements",
                changes: [
                    "Fixed a critical bug causing the dashboard to silently fail to load (blank screen).",
                    "Resolved overlapping invisible hitboxes for the Mage Profile and Duel Arena silhouettes.",
                    "Fixed the Arena and Mage Profile overlays to properly blur the dashboard instead of hiding it.",
                    "Restored Magical Toast notifications which were previously malfunctioning."
                ]
            },
            {
                version: "v2.2.4",
                date: "March 7, 2026",
                desc: "Dashboard UI Polish & Layout Simplification",
                changes: [
                    "Moved Spellbook (dictionary selector) to the top-right corner of the main dashboard for quicker access.",
                    "Removed Spellbook and Discipline from the central selectors to declutter the dashboard.",
                    "Moved Discipline (class selector) into the Mage Profile panel as an interactive dropdown.",
                    "Fixed: Multiple layout-breaking HTML structure errors that caused the dashboard to go blank."
                ]
            },
            {
                version: "v2.2.3",
                date: "March 3, 2026",
                desc: "Guest Mode, Magical Toasts & Scribe Improvements",
                changes: [
                    "Added Guest Account system — play without registering using a temporary Mage Title.",
                    "Guests can access Arcane Survival, The Scribe's Trial, and the Hall of Fame.",
                    "Guest scores are submitted to the leaderboard under their chosen alias.",
                    "Replaced all browser alert() dialogs with animated Magical Toast notifications.",
                    "Added Escape key support to instantly dismiss toasts and close the Duel Lobby.",
                    "Fixed: Dashboard blur/unclickable state after returning from Profile or Duel Lobby.",
                    "Fixed: Scribe mode and duration dropdowns were losing focus immediately when clicked.",
                    "Fixed: Scribe Timed mode now uses full paragraphs instead of random disconnected words.",
                    "Expanded Arcane Dictionary: ~150 new words and 15 new lore paragraphs added."
                ]
            },
            {
                version: "v2.2.2",
                date: "February 28, 2026",
                desc: "UI Polish & Layout Adjustments",
                changes: [
                    "Fixed the overlapping layout in the Mage Profile.",
                    "Adjusted the Start Menu layout to prevent scrolling on standard displays.",
                    "Fixed Mage and Tower silhouette hover interactions."
                ]
            },
            {
                version: "v2.2.1",
                date: "February 28, 2026",
                desc: "Emergency Patch - Mage Duel Fixes",
                changes: [
                    "Fixed an issue where creating a Mage Duel lobby would immediately start the game by oneself.",
                    "Corrected the Suppabase Realtime presence payload evaluation for the local host.",
                    "Added this enchanted Patch Board for easier access to updates!",
                    "Improved layout responsiveness on mobile devices (Silhouettes format to edges).",
                    "Added 'Enter' key support as an alternative to 'Tab' for casting Supernova."
                ]
            },
            {
                version: "v2.2.0",
                date: "February 27, 2026",
                desc: "Multiplayer Real-Time Mage Duels",
                changes: [
                    "Introduced 1v1 Mage Duels.",
                    "Battle other typers in real time using 6-character room codes.",
                    "Live opponent tracking (Score, WPM, Barriers) powered by Supabase Realtime."
                ]
            },
            {
                version: "v2.1.0",
                date: "February 23, 2026",
                desc: "The Scribe's Trial & Canvas Engine",
                changes: [
                    "New Practice Mode: The Scribe's Trial with timed modes (15s, 30s, 60s).",
                    "Added classic continuous-flow spaced-word mechanics and graphing.",
                    "Overhauled the game to run on an HTML5 `<canvas>` engine for better performance."
                ]
            }
        ];
    }

    init() {
        this.populatePatchBoard();
        this.setupListeners();
    }

    populatePatchBoard() {
        if (!this.patchNotesContainer) return;

        this.patchNotesContainer.innerHTML = '';
        this.patchNotes.forEach(patch => {
            const item = document.createElement('div');
            item.className = 'patch-item';

            const header = document.createElement('div');
            header.className = 'patch-header';
            header.innerHTML = `<span class="patch-version">${patch.version}</span><span class="patch-date">${patch.date}</span>`;

            const body = document.createElement('div');
            body.className = 'patch-body';
            const p = document.createElement('p');
            p.innerText = patch.desc;
            const ul = document.createElement('ul');

            patch.changes.forEach(change => {
                const li = document.createElement('li');
                li.innerText = change;
                ul.appendChild(li);
            });

            body.appendChild(p);
            body.appendChild(ul);
            item.appendChild(header);
            item.appendChild(body);
            this.patchNotesContainer.appendChild(item);
        });
    }

    setupListeners() {
        if (this.openPatchBoardBtn) {
            this.openPatchBoardBtn.addEventListener('click', () => {
                this.startMenu.classList.remove('active');
                this.startMenu.classList.add('hidden');
                this.patchBoardMenu.classList.remove('hidden');
                // small delay to let display:flex apply before opacity transition
                setTimeout(() => {
                    this.patchBoardMenu.classList.add('active');
                }, 10);
            });
        }

        if (this.closePatchBoardBtn) {
            this.closePatchBoardBtn.addEventListener('click', () => {
                this.patchBoardMenu.classList.remove('active');
                this.patchBoardMenu.classList.add('hidden');
                this.startMenu.classList.remove('hidden');
                this.startMenu.classList.add('active');
            });
        }
    }
}
