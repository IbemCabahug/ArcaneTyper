import { supabase } from '../../backend/supabaseClient.js';


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

        this.mageClassSelect = document.getElementById('mage-class-select');
        this.profileUsernameUI = document.getElementById('profile-username');
        this.profileNickname = document.getElementById('profile-nickname');

        // Guest DOM
        this.ccGuestBtn = document.getElementById('cc-guest-btn');
        this.ccGuestCancelMode = document.getElementById('cc-guest-cancel-mode');

        // Rate Limiting & Temporal Stasis Lockout
        this.failedAttempts = parseInt(sessionStorage.getItem('at_auth_failed_attempts') || '0', 10);
        this.lockoutUntil = parseInt(sessionStorage.getItem('at_auth_lockout_until') || '0', 10);
        this.lockoutTimer = null;
    }

    init(updateProgressionUIParams) {
        this.updateProgressionUICallback = updateProgressionUIParams;

        this.setupListeners();
        this.checkSession();

        if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
            this.startLockoutCountdown();
        }
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
        const discipline = this.ccClass ? this.ccClass.value : 'Scholar';

        if (this.isGuestMode) {
            if (!displayName) {
                if (this.ccErrorMsg) this.ccErrorMsg.innerText = "A Guest must provide a temporary Title.";
                return;
            }
            this.isGuest = true;
            this.game.stats.isAuthenticated = false; // guests never qualify for admin bypass
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

                const { data, error } = await supabase.auth.signInWithPassword({
                    email: loginEmail,
                    password: password,
                });

                this.ccCreateBtn.disabled = false;

                if (error) {
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
                const { data, error } = await supabase.auth.signUp({
                    email: emailToUse,
                    password: password,
                    options: {
                        data: {
                            mage_title: displayName,
                            discipline: discipline,
                            true_name: username
                        }
                    }
                });

                this.ccCreateBtn.disabled = false;

                if (error) {
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

        const meta = user.user_metadata || {};
        const emailName = user.email ? user.email.split('@')[0] : '';
        const name = String(meta.mage_title || '').trim()
            || String(cloudUsername || '').trim()
            || emailName
            || 'Anonymous Mage';

        const applied = this.game.stats.setMageName
            ? this.game.stats.setMageName(name)
            : (this.game.stats.mageName = name, true);

        console.info(`[AuthUI] Session identity resolved: ${this.game.stats.mageName}`);
        return applied;
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
