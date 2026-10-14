import { supabase } from '../../backend/supabaseClient.js';
import { DEFAULT_MAGE_CLASS, classesForCharacter, mageClassInfo, normalizeMageClass, normalizeMageClassForCharacter } from '../../backend/MageClasses.js';

export class AuthUI {
    constructor(game, startMenu, profileMenu) {
        this.game = game;
        this.startMenu = startMenu;
        this.profileMenu = profileMenu;

        // State
        this.isLoginMode = true;
        this.isGuestMode = false;
        this.isGuest = false;

        // DOM Elements
        this.ccMenu = document.getElementById('character-creation-menu');
        this.ccUsername = document.getElementById('cc-username');
        this.ccName = document.getElementById('cc-name');
        this.ccNicknameContainer = document.getElementById('cc-nickname-container');
        this.ccPassword = document.getElementById('cc-password');
        this.ccClass = document.getElementById('cc-class');
        this.ccClassContainer = document.getElementById('cc-class-container');
        this.ccCreateBtn = document.getElementById('cc-create-btn');
        this.ccErrorMsg = document.getElementById('cc-error-msg');
        this.ccToggleMode = document.getElementById('cc-toggle-mode');
        this.ccTitle = document.getElementById('cc-title');
        this.ccSubtitle = document.getElementById('cc-subtitle');
        this.ccEmailContainer = document.getElementById('cc-email-container');
        this.ccEmail = document.getElementById('cc-email');
        this.ccUsernameLabel = document.getElementById('cc-username-label');
        this.togglePasswordBtn = document.getElementById('toggle-password-btn');

        // NOTE (AT-L8): `#mage-class-select` lives in the Mage Profile menu and is
        // owned by ProfileUI — AuthUI only fills the registration picker
        // (`#cc-class`). Neither dropdown may hard-code the roster any more; both
        // are built from backend/MageClasses.js.
        this.profileUsernameUI = document.getElementById('profile-username');
        this.profileNickname = document.getElementById('profile-nickname');

        // Guest DOM
        this.ccGuestBtn = document.getElementById('cc-guest-btn');
        this.ccGuestCancelMode = document.getElementById('cc-guest-cancel-mode');

        // Rate Limiting & Temporal Stasis Lockout
        this.failedAttempts = parseInt(sessionStorage.getItem('at_auth_failed_attempts') || '0', 10);
        this.lockoutUntil = parseInt(sessionStorage.getItem('at_auth_lockout_until') || '0', 10);
        this.lockoutTimer = null;

        // Turnstile (Cloudflare) via Supabase-native CAPTCHA. OPT-IN: only active
        // when VITE_TURNSTILE_SITE_KEY is set at build time AND Supabase's "Enable
        // CAPTCHA protection" toggle is on. When the key is absent every helper
        // below is a no-op and auth behaves exactly as before (safe to merge
        // before Cloudflare/Supabase are configured).
        this.turnstileSiteKey = import.meta.env?.VITE_TURNSTILE_SITE_KEY || '';
        this.turnstileWidgetId = null;
        this.turnstileToken = '';
    }

    init(updateProgressionUIParams) {
        this.updateProgressionUICallback = updateProgressionUIParams;

        this._populateClassOptions();
        this.setupListeners();
        this.checkSession();

        if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
            this.startLockoutCountdown();
        }
    }

    /**
     * AT-L8: build the registration Discipline picker from the single roster.
     * The old static `<option>` list offered Scholar/Pyromancer/Oracle, which no
     * longer exists anywhere else in the project.
     */
    _populateClassOptions() {
        if (!this.ccClass) return;
        this.ccClass.innerHTML = '';
        classesForCharacter('wizard').forEach((cls) => {
            const opt = document.createElement('option');
            opt.value = cls.id;
            opt.textContent = `${cls.title} (${cls.tagline})`;
            opt.style.background = 'var(--bg-deep)';
            opt.style.textShadow = 'none';
            // Same fix as ProfileUI: an option with no colour of its own
            // inherits the parent select's, so the registration list for the
            // wizard family (the one family with three DIFFERENT colours) was
            // monochrome and repainted wholesale on every pick.
            opt.style.color = cls.color;
            this.ccClass.appendChild(opt);
        });
        this.ccClass.value = DEFAULT_MAGE_CLASS;
    }

    setupListeners() {
        // Password Visibility Toggle
        if (this.togglePasswordBtn && this.ccPassword) {
            this.togglePasswordBtn.addEventListener('click', () => {
                if (this.ccPassword.type === 'password') {
                    this.ccPassword.type = 'text';
                    this.togglePasswordBtn.classList.add('revealed');
                    this.togglePasswordBtn.title = "Hide Password";
                } else {
                    this.ccPassword.type = 'password';
                    this.togglePasswordBtn.classList.remove('revealed');
                    this.togglePasswordBtn.title = "Dispel Illusion (Reveal Password)";
                }
            });
        }

        // Toggle Login / Register
        if (this.ccToggleMode) {
            this.ccToggleMode.addEventListener('click', (e) => {
                e.preventDefault();
                this.isLoginMode = !this.isLoginMode;
                this.ccErrorMsg.innerText = '';

                if (this.isLoginMode) {
                    this.ccTitle.innerText = "MAGE RECOGNITION";
                    this.ccSubtitle.innerText = "Speak your Owl Delivery and Incantation.";
                    this.ccClassContainer.style.display = 'none';
                    this.ccNicknameContainer.style.display = 'none';
                    if (!this.lockoutUntil || Date.now() >= this.lockoutUntil) {
                        this.ccCreateBtn.innerText = "ENTER LIBRARY";
                    }
                    this.ccToggleMode.innerText = "I need to register a new Mage Card.";
                    this.ccEmailContainer.style.display = 'none';
                    this.ccUsernameLabel.innerText = "Owl Delivery (Email Address):";
                    this.ccUsername.placeholder = "e.g. mage@library.com";
                } else {
                    this.ccTitle.innerText = "MAGE REGISTRATION";
                    this.ccSubtitle.innerText = "Forge your identity before entering the library.";
                    this.ccClassContainer.style.display = 'flex';
                    this.ccNicknameContainer.style.display = 'flex';
                    this.ccEmailContainer.style.display = 'flex';
                    this.ccUsernameLabel.innerText = "True Name (Username):";
                    this.ccUsername.placeholder = "e.g. invoker123";
                    if (!this.lockoutUntil || Date.now() >= this.lockoutUntil) {
                        this.ccCreateBtn.innerText = "SEAL MAGE CARD";
                    }
                    this.ccToggleMode.innerText = "Already have a Mage Card?";
                }

                if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
                    this.startLockoutCountdown();
                }
            });
        }

        // Guest Mode Listeners
        if (this.ccGuestBtn && this.ccGuestCancelMode) {
            this.ccGuestBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.isGuestMode = true;
                this.ccErrorMsg.innerText = '';

                this.ccTitle.innerText = "GUEST ACCESS";
                this.ccSubtitle.innerText = "Provide a temporary Mage Title.";

                this.ccUsernameLabel.parentElement.style.display = 'none';
                this.ccEmailContainer.style.display = 'none';
                this.ccPassword.parentElement.parentElement.style.display = 'none';
                this.ccClassContainer.style.display = 'none';

                this.ccNicknameContainer.style.display = 'flex';
                this.ccName.placeholder = "e.g. Wandering Scribe";

                this.ccCreateBtn.disabled = false;
                this.ccCreateBtn.innerText = "ENTER AS GUEST";
                this.ccGuestBtn.style.display = 'none';
                this.ccToggleMode.style.display = 'none';
                this.ccGuestCancelMode.style.display = 'block';
            });

            this.ccGuestCancelMode.addEventListener('click', (e) => {
                e.preventDefault();
                this.isGuestMode = false;
                this.ccErrorMsg.innerText = '';

                this.isLoginMode = true;
                this.ccTitle.innerText = "MAGE RECOGNITION";
                this.ccSubtitle.innerText = "Speak your Owl Delivery and Incantation.";

                this.ccUsernameLabel.parentElement.style.display = 'flex';
                this.ccPassword.parentElement.parentElement.style.display = 'flex';
                this.ccNicknameContainer.style.display = 'none';
                this.ccEmailContainer.style.display = 'none';
                this.ccClassContainer.style.display = 'none';

                this.ccGuestBtn.style.display = 'block';
                this.ccToggleMode.style.display = 'block';
                this.ccGuestCancelMode.style.display = 'none';

                if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
                    this.startLockoutCountdown();
                } else {
                    this.ccCreateBtn.disabled = false;
                    this.ccCreateBtn.innerText = "ENTER LIBRARY";
                }
            });
        }

        // Create / Setup Account Button
        this.ccCreateBtn.addEventListener('click', async () => {
            await this.handleAuthSubmit();
        });
    }

    async handleAuthSubmit() {
        if (!this.isGuestMode && this.lockoutUntil && Date.now() < this.lockoutUntil) {
            this.startLockoutCountdown();
            return;
        }
        const username = this.ccUsername.value.trim().toLowerCase();
        const displayName = this.ccName.value.trim();
        const password = this.ccPassword ? this.ccPassword.value : '';
        const discipline = normalizeMageClass(this.ccClass ? this.ccClass.value : DEFAULT_MAGE_CLASS);

        if (this.isGuestMode) {
            if (!displayName) {
                if (this.ccErrorMsg) this.ccErrorMsg.innerText = "A Guest must provide a temporary Title.";
                return;
            }
            this.isGuest = true;
            this.game.stats.isAuthenticated = false; // guests never qualify for admin bypass
            // AT-F21a: drop the captured auth id too. `isAuthenticated = false`
            // alone already fails isAdmin()'s first condition, but leaving a real
            // user's id on the object means the bypass is one flag-flip away on a
            // shared browser — and this is the exact "next account inherits the
            // previous one's state" class of bug the PROGRESSION_KEYS list exists
            // to prevent for localStorage.
            this.game.stats.authUserId = null;
            this.game.stats.authEmail = null;
            this.game.stats.mageName = "Guest " + displayName;
            this.game.stats.saveProgression();

            this.ccErrorMsg.innerText = '';
            this.ccMenu.classList.add('hidden');
            this.ccMenu.classList.remove('active');
            this.startMenu.classList.remove('hidden');
            this.startMenu.classList.add('active');
            return;
        }

        if (!username) {
            if (this.ccErrorMsg) this.ccErrorMsg.innerText = "A Mage must have a True Name (Login ID).";
            return;
        }

        if (!this.isLoginMode && !displayName) {
            if (this.ccErrorMsg) this.ccErrorMsg.innerText = "A Mage must have a Title (Display Name).";
            return;
        }

        const emailToUse = this.ccEmail && this.ccEmail.value.trim() ? this.ccEmail.value.trim() : '';

        if (!this.isLoginMode && !emailToUse) {
            if (this.ccErrorMsg) this.ccErrorMsg.innerText = "Registration requires an Owl Delivery (Email Address).";
            return;
        }

        if (supabase) {
            if (!password) {
                if (this.ccErrorMsg) this.ccErrorMsg.innerText = "A Mage must provide their Secret Incantation (Password).";
                return;
            }

            this.ccCreateBtn.disabled = true;

            if (this.isLoginMode) {
                const isEmail = username.includes('@');
                let loginEmail = isEmail ? username : '';

                if (!isEmail) {
                    if (this.ccErrorMsg) this.ccErrorMsg.innerText = "To log in securely, please provide your Owl Delivery (Email) instead of your True Name.";
                    this.ccCreateBtn.disabled = false;
                    return;
                }

                const captchaToken = await this._getTurnstileToken();
                const { data, error } = await supabase.auth.signInWithPassword({
                    email: loginEmail,
                    password: password,
                    options: captchaToken ? { captchaToken } : undefined,
                });

                this.ccCreateBtn.disabled = false;

                if (error) {
                    this._resetTurnstile(); // token is single-use; force a fresh one next attempt
                    this.failedAttempts++;
                    sessionStorage.setItem('at_auth_failed_attempts', this.failedAttempts.toString());

                    // If Supabase server itself triggered a rate limit (429)
                    if (error.message && error.message.toLowerCase().includes('rate limit')) {
                        const durationSec = 60;
                        this.lockoutUntil = Date.now() + durationSec * 1000;
                        sessionStorage.setItem('at_auth_lockout_until', this.lockoutUntil.toString());
                        this.startLockoutCountdown();
                        return;
                    }

                    // Client-side rate limit lock after 5 consecutive failed attempts
                    if (this.failedAttempts >= 5) {
                        const durationSec = Math.min(120, 30 * Math.pow(2, Math.floor((this.failedAttempts - 5) / 2)));
                        this.lockoutUntil = Date.now() + durationSec * 1000;
                        sessionStorage.setItem('at_auth_lockout_until', this.lockoutUntil.toString());
                        this.startLockoutCountdown();
                        return;
                    }

                    const attemptsLeft = 5 - this.failedAttempts;
                    if (this.ccErrorMsg) {
                        this.ccErrorMsg.innerText = `${error.message} (${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining before temporal stasis)`;
                    }
                    return;
                }

                // Successful login — reset rate limiting counters
                this.resetRateLimitState();

                this.game.stats.isAuthenticated = true;

                // Cloud progress first, then the authoritative display name on
                // top: loadFromSupabase() writes profile.username, which is
                // itself derived from whatever name this account last used.
                const { data: profile, error: profileError } = await supabase
                    .from('profiles').select('*').eq('id', data.user.id).single();

                if (profile) {
                    this.game.stats.loadFromSupabase(profile);
                } else if (profileError && profileError.code !== 'PGRST116') {
                    console.warn('[AuthUI] Could not read the cloud profile:', profileError.message);
                }

                // Identity comes from THIS session only — never from
                // localStorage, which may still hold the previous mage's name.
                this._applyIdentity(data.session || { user: data.user }, profile && profile.username);

                // Persist immediately (and create the row when it is missing).
                await this.game.stats.saveProgression();

            } else {
                const captchaToken = await this._getTurnstileToken();
                const { data, error } = await supabase.auth.signUp({
                    email: emailToUse,
                    password: password,
                    options: {
                        data: {
                            mage_title: displayName,
                            discipline: discipline,
                            true_name: username
                        },
                        ...(captchaToken ? { captchaToken } : {}),
                    }
                });

                this.ccCreateBtn.disabled = false;

                if (error) {
                    this._resetTurnstile(); // token is single-use; force a fresh one next attempt
                    if (error.message.toLowerCase().includes('rate limit')) {
                        console.warn("Supabase rate limit exceeded. Engaging temporal stasis.");
                        this.lockoutUntil = Date.now() + 60000;
                        sessionStorage.setItem('at_auth_lockout_until', this.lockoutUntil.toString());
                        this.startLockoutCountdown();
                        return;
                    } else {
                        if (this.ccErrorMsg) this.ccErrorMsg.innerText = error.message;
                        return;
                    }
                } else {
                    // Real account created - authenticated, non-guest.
                    this.resetRateLimitState();
                    this.game.stats.isAuthenticated = true;
                    this._applyIdentity(data.session || { user: data.user }, null);

                    // AT-L8: the Discipline picked at registration now actually
                    // becomes the class. Before this it was only signUp metadata
                    // (`discipline`) that nothing ever read back, so every new
                    // account stayed 'Novice' no matter what they chose.
                    this.game.stats.setMageClass(discipline);
                }
            }
        } else {
            this.game.stats.mageName = this.isLoginMode ? username : displayName;
        }

        await this.game.stats.saveProgression();

        if (this.ccErrorMsg) this.ccErrorMsg.innerText = '';
        this.ccMenu.classList.add('hidden');
        this.ccMenu.classList.remove('active');

        if (this.updateProgressionUICallback) {
            this.updateProgressionUICallback();
        }

        this.startMenu.classList.remove('hidden');
        this.startMenu.classList.add('active');
    }

    showCharacterCreation() {
        this.startMenu.classList.add('hidden');
        this.startMenu.classList.remove('active');

        this.ccMenu.classList.remove('hidden');
        this.ccMenu.classList.add('active');

        // Start the Turnstile widget as soon as the form opens instead of on
        // submit: loading the Cloudflare script is async, so a submit-triggered
        // init raced the script load and shipped that attempt with no token.
        // The reset also clears a token a previous attempt already consumed
        // (e.g. logout → login again without a page reload).
        this._resetTurnstile();
        this._initTurnstile();

        this.ccUsername.focus();
    }

    async checkSession() {
        this.startMenu.classList.add('hidden');
        this.startMenu.classList.remove('active');

        if (!supabase) {
            console.warn("Supabase not configured. Bypassing auth.");
            if (!this.game.stats.mageName) {
                this.showCharacterCreation();
            } else {
                this.startMenu.classList.remove('hidden');
                this.startMenu.classList.add('active');
            }
            return;
        }

        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
            this.game.stats.isAuthenticated = true;

            // Cloud progress first, then the authoritative name on top of it.
            const { data: profile, error: profileError } = await supabase
                .from('profiles').select('*').eq('id', session.user.id).single();

            if (profile) {
                this.game.stats.loadFromSupabase(profile);
            } else if (profileError && profileError.code !== 'PGRST116') {
                console.warn('[AuthUI] Could not read the cloud profile:', profileError.message);
            }

            // Always re-derive the display name from the session. The previous
            // code kept whatever localStorage held, so a second account on the
            // same browser inherited the first mage's name (and the dashboard
            // showed "Anonymous Mage" for everyone).
            this._applyIdentity(session, profile && profile.username);

            // Also repairs/creates the cloud row for accounts that never had one.
            await this.game.stats.saveProgression();

            if (this.updateProgressionUICallback) {
                this.updateProgressionUICallback();
            }

            this.startMenu.classList.remove('hidden');
            this.startMenu.classList.add('active');
        } else {
            this.showCharacterCreation();
        }
    }

    /**
     * Resolves the mage display name from THIS session only.
     * Priority: auth metadata `mage_title` → the cloud profile's username →
     * the email prefix. localStorage is deliberately not a source.
     * @param {{user?: object}} session
     * @param {string|null} cloudUsername profiles.username for this user
     */
    _applyIdentity(session, cloudUsername = null) {
        const user = session && session.user;
        if (!user) return false;

        // AT-F21a: capture the auth identity FIRST, before anything else can bail.
        // This is the only place the admin bypass gets its input, and all three
        // authenticated paths (login, register, session restore) pass through
        // here, so it is the one place that can be relied on to have run.
        //
        // It is set from the SESSION, never from the display name: `user.id` is
        // issued by Supabase, cannot be chosen at signup and cannot be edited
        // afterwards. The old check keyed on `mageName === 'admin'`, which every
        // player controls — that is the hole AT-F21 closes.
        const stats = this.game.stats;
        if (stats) {
            stats.authUserId = user.id || null;
            stats.authEmail = user.email || null;
        }

        const meta = user.user_metadata || {};
        const emailName = user.email ? user.email.split('@')[0] : '';
        const name = String(meta.mage_title || '').trim()
            || String(cloudUsername || '').trim()
            || emailName
            || 'Anonymous Mage';

        const applied = stats && stats.setMageName
            ? stats.setMageName(name)
            : (stats.mageName = name, true);

        // Debug aid only. The id is what decides; the address is printed so an
        // admin can confirm which account the bypass actually resolved to.
        if (stats && stats.isAdmin) {
            console.info(`[AuthUI] Admin bypass: ${stats.isAdmin() ? 'GRANTED' : 'not granted'} for ${user.email || 'unknown'}`);
        }
        console.info(`[AuthUI] Session identity resolved: ${stats ? stats.mageName : '(none)'}`);
        return applied;
    }

    // ---------------------------------------------------------------------
    // Turnstile (Cloudflare) via Supabase-native CAPTCHA.
    // OPT-IN via VITE_TURNSTILE_SITE_KEY. Enforcement is server-side (Supabase
    // GoTrue validates the token with Cloudflare Siteverify); the client only
    // supplies it. No key => all methods below are no-ops => auth unchanged.
    // ---------------------------------------------------------------------
    _turnstileEnabled() {
        return Boolean(this.turnstileSiteKey);
    }

    /** Lazily load the Cloudflare script and mount the widget in #cc-turnstile. */
    _initTurnstile() {
        if (!this.turnstileSiteKey) return;
        const mount = document.getElementById('cc-turnstile');
        if (!mount) return;

        const render = () => {
            if (!window.turnstile || this.turnstileWidgetId !== null) return;
            try {
                this.turnstileWidgetId = window.turnstile.render(mount, {
                    sitekey: this.turnstileSiteKey,
                    theme: 'dark',
                    callback: (token) => { this.turnstileToken = token; },
                    'expired-callback': () => { this.turnstileToken = ''; },
                    'error-callback': () => { this.turnstileToken = ''; return true; },
                });
            } catch (e) {
                console.warn('[AuthUI] Turnstile render failed:', e);
            }
        };

        if (window.turnstile) { render(); return; }

        let s = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
        if (!s) {
            s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            s.async = true;
            s.defer = true;
            s.addEventListener('error', () => console.warn('[AuthUI] Turnstile script failed to load'));
            document.head.appendChild(s);
        }
        s.addEventListener('load', render);
    }

    /**
     * Return a Turnstile token for the pending auth call, or '' when CAPTCHA is
     * off/unavailable. The Cloudflare script loads asynchronously, so we wait
     * (bounded) for the script + widget before looking for a response; if the
     * widget hasn't solved yet we trigger execute() and wait for the callback.
     * A single shared deadline keeps the submit button from stalling too long.
     * @returns {Promise<string>}
     */
    async _getTurnstileToken() {
        if (!this.turnstileSiteKey) return '';
        if (this.turnstileWidgetId === null) this._initTurnstile();

        // Never bail out just because the script hasn't arrived yet — returning
        // '' instantly on a cold load meant the FIRST attempt after every page
        // reload shipped with no token at all.
        const deadline = Date.now() + 8000;
        while (!window.turnstile || this.turnstileWidgetId === null) {
            if (Date.now() >= deadline) return '';
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        let token = this.turnstileToken || window.turnstile.getResponse(this.turnstileWidgetId);
        if (!token) {
            try { window.turnstile.execute(this.turnstileWidgetId); } catch (_) { /* managed auto-runs */ }
            token = await this._waitForTurnstileToken(Math.max(0, deadline - Date.now()));
        }
        return token || '';
    }

    /** Poll until the widget callback yields a token, or the timeout elapses. */
    _waitForTurnstileToken(timeoutMs) {
        return new Promise((resolve) => {
            const started = Date.now();
            const poll = setInterval(() => {
                const t = this.turnstileToken
                    || (window.turnstile && this.turnstileWidgetId !== null ? window.turnstile.getResponse(this.turnstileWidgetId) : '');
                if (t) { clearInterval(poll); resolve(t); }
                else if (Date.now() - started > timeoutMs) { clearInterval(poll); resolve(''); }
            }, 100);
        });
    }

    /** Tokens are single-use; reset the widget after each attempt. */
    _resetTurnstile() {
        if (!this.turnstileSiteKey || !window.turnstile || this.turnstileWidgetId === null) return;
        this.turnstileToken = '';
        try { window.turnstile.reset(this.turnstileWidgetId); } catch (_) { /* ignore */ }
    }

    startLockoutCountdown() {
        if (this.lockoutTimer) clearInterval(this.lockoutTimer);

        const update = () => {
            const now = Date.now();
            if (now >= this.lockoutUntil) {
                clearInterval(this.lockoutTimer);
                this.lockoutTimer = null;
                this.lockoutUntil = 0;
                sessionStorage.removeItem('at_auth_lockout_until');
                this.ccCreateBtn.disabled = false;
                this.ccCreateBtn.innerText = this.isGuestMode ? "ENTER AS GUEST" : (this.isLoginMode ? "ENTER LIBRARY" : "SEAL MAGE CARD");
                if (this.ccErrorMsg) this.ccErrorMsg.innerText = "";
                return;
            }

            const sec = Math.ceil((this.lockoutUntil - now) / 1000);
            this.ccCreateBtn.disabled = true;
            this.ccCreateBtn.innerText = `TEMPORAL STASIS (${sec}s)`;
            if (this.ccErrorMsg) {
                this.ccErrorMsg.innerText = `Too many failed incantations. Chamber locked for ${sec}s.`;
            }
        };

        update();
        this.lockoutTimer = setInterval(update, 1000);
    }

    resetRateLimitState() {
        this.failedAttempts = 0;
        this.lockoutUntil = 0;
        sessionStorage.removeItem('at_auth_failed_attempts');
        sessionStorage.removeItem('at_auth_lockout_until');
        if (this.lockoutTimer) {
            clearInterval(this.lockoutTimer);
            this.lockoutTimer = null;
        }
    }
}
