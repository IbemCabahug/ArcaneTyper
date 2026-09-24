import './style.css';
import './critical.css';
import { Game } from './Game.js';
import { Scribe } from './Scribe.js';
import { MagicalToast } from './ui/MagicalToast.js';
import { ProfileUI } from './ui/ProfileUI.js';
import { AuthUI } from './ui/AuthUI.js';
import { MenuUI } from './ui/MenuUI.js';
import { Leaderboard } from '../backend/Leaderboard.js';
import { Duel } from '../backend/Duel.js';
import { supabase } from '../backend/supabaseClient.js';
import { dbHealth } from '../backend/dbHealth.js';
import { syncQueue } from '../backend/syncQueue.js';
import { DuelRace } from './game/DuelRace.js';
import { mageClassInfo } from '../backend/MageClasses.js';
import { characterInfo } from '../backend/Characters.js';
import { CharacterRenderer } from './game/CharacterRenderer.js';


document.addEventListener('DOMContentLoaded', async () => {
  // Global error routing: ANY uncaught error or rejected promise anywhere in
  // the app is surfaced in the on-screen banner instead of dying silently in
  // some handler (e.g. keydown) where it could break gameplay invisibly.
  const routeToBanner = (msg) => {
    console.error('[ArcaneTyper] global:', msg);
    const gameRef = window.game;
    if (gameRef && gameRef._reportError) {
      gameRef._reportError(msg instanceof Error ? msg : new Error(String(msg)), 'global');
    }
  };
  window.addEventListener('error', (e) => routeToBanner(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => routeToBanner(e.reason));

  // Canvas Font Readiness
  // Ensures Google Fonts Cinzel is ready without failing or stalling page initialization
  try {
    if (document.fonts) {
      await Promise.race([
        document.fonts.load('bold 32px Cinzel'),
        document.fonts.ready,
        new Promise(resolve => setTimeout(resolve, 600))
      ]);
    }
  } catch (e) {
    console.warn("[ArcaneTyper] Font preload fallback active:", e);
  }

  const game = new Game('game-canvas');
  window.game = game; // global error router + Stats.js combo-sound hook rely on this
  const leaderboard = new Leaderboard();
  const scribe = new Scribe(game.dictionary, game.stats);

  MagicalToast.init();
  const profileUI = new ProfileUI(game);
  const authUI = new AuthUI(game, document.getElementById('start-menu'), document.getElementById('profile-menu'));
  const menuUI = new MenuUI(game, document.getElementById('start-menu'));

  menuUI.init();

  // ── Cloud sync wiring ──────────────────────────────────────────────────────
  // Before 2026-09-23 every Supabase failure ended as a console.warn, so a
  // paused project looked exactly like "my progress vanished". Now:
  //   dbHealth  → probes the project and shows an on-screen status chip
  //   syncQueue → replays writes that failed while it was unreachable
  syncQueue.onChange = (items) => dbHealth.setPendingCount(items.length);
  dbHealth.setPendingCount(syncQueue.count());
  dbHealth.onChange((status) => {
    if (status === 'online') syncQueue.flush();
  });
  dbHealth.startWatch();
  syncQueue.start();

  // AT-M8: confirm the previous pageload's unload-banked run survived. The
  // one-shot flag is consumed here (removed BEFORE parsing, so a corrupt value
  // can never toast twice) and is also purged by logout via PROGRESSION_KEYS.
  try {
    const bankedFlag = localStorage.getItem('typerMaster_lastRunBanked');
    if (bankedFlag) {
      localStorage.removeItem('typerMaster_lastRunBanked');
      const banked = JSON.parse(bankedFlag);
      MagicalToast.show(
        `⌛ Run banked — your ${banked.score}-point run survived the refresh and is syncing.`,
        5000
      );
    }
  } catch (e) { /* ignore — the flag is an extra, never a source of truth */ }

  // UI Elements
  const hud = document.getElementById('hud');
  const startMenu = document.getElementById('start-menu');
  const gameOverMenu = document.getElementById('game-over-menu');
  const leaderboardMenu = document.getElementById('leaderboard-menu');
  const practiceUi = document.getElementById('practice-ui');
  const workshopMenu = document.getElementById('workshop-menu');
  const achievementsMenu = document.getElementById('achievements-menu');
  const pauseMenu = document.getElementById('pause-menu');
  const resumeBtn = document.getElementById('resume-btn');
  const pauseReturnBtn = document.getElementById('pause-return-btn');
  const pauseVolumeSlider = document.getElementById('pause-volume-slider');
  const pauseVolumeVal = document.getElementById('pause-volume-val');
  const pauseMuteBtn = document.getElementById('pause-mute-btn');
  const hudSoundBtn = document.getElementById('hud-sound-btn');

  const menuMageTitle = document.getElementById('menu-mage-title');
  const openAchievementsBtn = document.getElementById('open-achievements-icon-btn');
  const closeAchievementsBtn = document.getElementById('close-achievements-btn');
  const achievementsList = document.getElementById('achievements-list');

  // Duel UI
  const duelLobbyMenu = document.getElementById('duel-lobby-menu');
  const duelLobbyIdlePanel = document.getElementById('duel-lobby-idle');
  const duelLobbyWaitingPanel = document.getElementById('duel-lobby-waiting');
  const duelResultMenu = document.getElementById('duel-result-menu');
  const duelRoomInput = document.getElementById('duel-room-input');
  const duelRoomCodeDisplay = document.getElementById('duel-room-code-display');
  const duelLobbyError = document.getElementById('duel-lobby-error');
  const duelResultTitle = document.getElementById('duel-result-title');
  const duelResultSubtitle = document.getElementById('duel-result-subtitle');
  const duelResMyScore = document.getElementById('duel-res-my-score');
  const duelResOppScore = document.getElementById('duel-res-opp-score');

  // Game Over Stats
  const goScore = document.getElementById('go-score');
  const goWords = document.getElementById('go-words');
  const goWpm = document.getElementById('go-wpm');
  const goAcc = document.getElementById('go-acc');
  const goStreak = document.getElementById('go-streak');

  // Highscore Forms
  const newHighscoreForm = document.getElementById('new-highscore-form');
  const playerNameInput = document.getElementById('player-name-input');
  const submitScoreBtn = document.getElementById('submit-score-btn');

  const scribeHighscoreForm = document.getElementById('scribe-highscore-form');
  const scribeNameInput = document.getElementById('scribe-name-input');
  const scribeSubmitBtn = document.getElementById('scribe-submit-btn');

  // Buttons
  const startBtn = document.getElementById('start-btn');
  const practiceBtn = document.getElementById('practice-btn');
  const practiceReturnBtn = document.getElementById('practice-return-btn');
  const practiceRetryBtn = document.getElementById('practice-retry-btn');
  const restartBtn = document.getElementById('restart-btn');
  const returnDashboardBtn = document.getElementById('return-dashboard-btn');
  const forfeitBtn = document.getElementById('forfeit-btn');
  const openLeaderboardBtn = document.getElementById('open-leaderboard-btn');
  const closeLeaderboardBtn = document.getElementById('close-leaderboard-btn');
  const workshopBtn = document.getElementById('workshop-btn');
  const closeWorkshopBtn = document.getElementById('close-workshop-btn');
  const tabBtns = document.querySelectorAll('.tab-btn');

  // Workshop Elements
  const workshopXp = document.getElementById('workshop-xp');
  const workshopLevel = document.getElementById('workshop-level');
  const skillNodes = document.querySelectorAll('.skill-node');
  const wandBtns = document.querySelectorAll('.wand-style-btn');

  // Scribe mode controls
  const scribeModeSelect = document.getElementById('scribe-mode-select');
  const scribeDurationSelect = document.getElementById('scribe-duration-select');
  const scribeTimerContainer = document.getElementById('scribe-timer-container');

  // Difficulty & Mode Select
  const difficultySelect = document.getElementById('difficulty-select');
  const modeSelect = document.getElementById('mode-select');
  const dictionarySelect = document.getElementById('dictionary-select');
  const leaderboardDifficultyFilter = document.getElementById('leaderboard-difficulty-filter');

  // WPM Graph
  const wpmGraphCanvas = document.getElementById('wpm-graph-canvas');

  // Mobile Support
  const mobileInput = document.getElementById('mobile-input');
  const mobileNovaBtn = document.getElementById('mobile-nova-btn');

  // AT-M9: two `pendingStats` / `pendingScribeStats` locals used to sit here,
  // declared and never read once. They are gone along with the dead `isGuest`
  // flag further down — dead state in this file is not harmless: it is what a
  // later reader trusts (that is how the gate below rotted).

  // Duel State
  let duel = null;
  let duelActive = false;
  let race = null; // AT-F9 shared-arena race controller
  // AT-F9: the 3..2..1 FIGHT countdown's bookkeeping, owned here (not inside
  // startDuel) so endDuel can kill a countdown that is still running when a
  // match ends before FIGHT — otherwise the interval reaches its last tick and
  // dereferences the already-cleared `duel` (owner-reported TypeError).
  let duelCountdown = null; // { interval, overlay }
  // AT-F9: the survival death-screen hook that startDuel swaps out for the duel
  // forfeit path. endDuel hands it back, or every later survival death stalls.
  let survivalGameOver = null;

  // ── AT-F9 presence hardening ──────────────────────────────────────────────
  // Supabase presence emits `leave` (+`join`) for the SAME key whenever a client
  // re-tracks it: Duel.markInMatch() re-sends our presence at FIGHT start, and
  // sockets re-track after a reconnect. Acting on the raw `leave` ended the duel
  // mid-countdown on the other browser and then crashed that browser's running
  // countdown. Presence *state*, not the event, decides who is really gone.
  const PRESENCE_SETTLE_MS = 1200;

  /**
   * Resolves true only when the opponent's presence key is genuinely absent,
   * giving a re-track one settle beat to re-appear. Never touches a newer
   * duel/match that took over while we waited.
   */
  function opponentConfirmedGone() {
    return new Promise((resolve) => {
      const watched = duel;
      if (!watched || !watched.channel) { resolve(true); return; }
      setTimeout(() => {
        if (duel !== watched || !duelActive || race) { resolve(false); return; }
        let others = 0;
        try {
          others = Object.keys(watched.channel.presenceState())
            .filter(k => k !== watched.presenceKey).length;
        } catch (err) { others = 0; }
        resolve(others === 0);
      }, PRESENCE_SETTLE_MS);
    });
  }

  /**
   * Pre-FIGHT `leave` handling, shared by both lobby paths (AT-F9). DuelRace owns
   * the in-match 5 s grace, so this bows out once a race exists.
   */
  function onLobbyOpponentLeft() {
    if (!duelActive || race) return;
    opponentConfirmedGone().then((gone) => { if (gone) endDuel(true, 'disconnect'); });
  }

  // Global State
  // AT-M9: this used to be `let isGuest = false;` — read by four guards (the
  // Workshop, the Arena lobby, the Forge and the profile label) and assigned by
  // NOTHING, so all four were dead code: a guest could open the Workshop and the
  // Arena lobby, and forge AT-F16's 12,000 XP character out of local XP.
  // The truth is `Stats.isAuthenticated`, which AuthUI maintains on password
  // login, registration and session restore (and clears on guest entry), so this
  // is DERIVED at use time — the cached copy is what went stale.
  const isGuest = () => !game.stats.isAuthenticated;
  // Gate for the entitlement menus: on a configured deployment a guest is
  // prompted instead of let in; with no backend there is nothing to sign in as,
  // so the local sandbox stays open (Stats.requiresMageCard owns that rule).
  const needsMageCard = () => game.stats.requiresMageCard(!!supabase);

  authUI.init(() => {
    profileUI.updateMenuStats();
  });

  // ========== ACHIEVEMENTS SYSTEM ==========
  const initTitle = localStorage.getItem('typerMaster_equippedTitle') || 'Apprentice';
  if (menuMageTitle) menuMageTitle.innerText = initTitle;

  openAchievementsBtn.addEventListener('click', () => {
    startMenu.classList.remove('active');
    startMenu.classList.add('hidden');
    achievementsMenu.classList.remove('hidden');
    populateAchievements();
    setTimeout(() => achievementsMenu.classList.add('active'), 10);
  });

  closeAchievementsBtn.addEventListener('click', () => {
    achievementsMenu.classList.remove('active');
    achievementsMenu.classList.add('hidden');
    startMenu.classList.remove('hidden');
    startMenu.classList.add('active');
  });

  function populateAchievements() {
    if (!achievementsList) return;
    achievementsList.innerHTML = '';
    const allDefs = game.achievements.definitions;
    const unlocked = game.achievements.unlocked;
    const equippedTitle = localStorage.getItem('typerMaster_equippedTitle') || null;

    if (equippedTitle && menuMageTitle) {
      menuMageTitle.innerText = equippedTitle;
    }

    for (const id in allDefs) {
      const def = allDefs[id];
      const isUnlocked = unlocked.has(id);
      const isEquipped = equippedTitle === def.title;

      const card = document.createElement('div');
      card.style.background = isUnlocked ? 'linear-gradient(135deg, rgba(20,10,40,0.8), rgba(40,20,60,0.9))' : 'rgba(10,5,20,0.8)';
      card.style.border = isUnlocked ? '1px solid #f9a825' : '1px solid #333';
      card.style.borderRadius = '8px';
      card.style.padding = '15px';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '8px';

      card.innerHTML = `
          <h3 style="color: ${isUnlocked ? '#f9a825' : '#666'}; margin: 0; font-family: Cinzel, serif; letter-spacing: 1px;">${isUnlocked ? def.name : '???'}</h3>
          <p style="color: ${isUnlocked ? '#ccc' : '#444'}; font-size: 0.85rem; margin: 0; line-height: 1.4;">${isUnlocked ? def.description : 'Locked Achievement'}</p>
          ${isUnlocked ? `<div style="margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(255,215,0,0.2);"><p style="color: #b892b0; font-size: 0.8rem; margin: 0;">Unlocks Title: <span style="color: #fff; font-weight: bold;">${def.title}</span></p></div>` : ''}
      `;

      if (isUnlocked) {
        const equipBtn = document.createElement('button');
        equipBtn.className = 'primary-btn';
        equipBtn.style.padding = '5px 10px';
        equipBtn.style.fontSize = '0.8rem';
        equipBtn.style.width = '100%';
        equipBtn.style.marginTop = '10px';
        equipBtn.innerText = isEquipped ? 'EQUIPPED' : 'EQUIP TITLE';
        if (isEquipped) {
          equipBtn.style.background = 'rgba(76, 175, 80, 0.2)';
          equipBtn.style.border = '1px solid #4CAF50';
          equipBtn.style.color = '#4CAF50';
        } else {
          equipBtn.style.background = 'linear-gradient(45deg, #1b0a2a, #3a155c)';
          equipBtn.style.border = '1px solid #d500f9';
        }
        equipBtn.onclick = () => {
          localStorage.setItem('typerMaster_equippedTitle', def.title);
          populateAchievements(); // re-render list to update buttons
        };
        card.appendChild(equipBtn);
      }

      achievementsList.appendChild(card);
    }
  }

  // Hook into in-game toasts
  game.achievements.onUnlockCallback = (def) => {
    MagicalToast.show(`🏆 <b>Achievement Unlocked</b><br><span style="color: #f9a825;">${def.name}</span><br><span style="font-size: 0.8rem; color: var(--text-muted);">${def.title}</span>`, 4000);
  };

  profileUI.updateMenuStats();

  // ── Scribe mode selector ───────────────────────────────────────────────────

  function applyModeUI() {
    const isTimed = scribeModeSelect.value === 'timed';
    scribeDurationSelect.classList.toggle('hidden', !isTimed);
    scribeTimerContainer.classList.toggle('hidden', !isTimed);
    // Sync the initial timer label to the selected duration
    const timerDisplay = document.getElementById('scribe-timer-display');
    if (timerDisplay) timerDisplay.textContent = scribeDurationSelect.value;
  }
  applyModeUI(); // Set correct initial state

  scribeModeSelect.addEventListener('change', () => {
    applyModeUI();
    // Restart if practice is already active (skipFocus = true to avoid dropdown losing focus)
    if (scribe.isRunning) startPractice(true);
  });

  scribeDurationSelect.addEventListener('change', () => {
    const timerDisplay = document.getElementById('scribe-timer-display');
    if (timerDisplay) timerDisplay.textContent = scribeDurationSelect.value;
    // Restart if practice is already active (skipFocus = true)
    if (scribe.isRunning) startPractice(true);
  });

  // ── Game Flow ─────────────────────────────────────────────────────────────

  function startGame() {
    startBtn.blur();
    restartBtn.blur();

    startMenu.classList.remove('active');
    startMenu.classList.add('hidden');
    gameOverMenu.classList.remove('active');
    gameOverMenu.classList.add('hidden');
    leaderboardMenu.classList.remove('active');
    leaderboardMenu.classList.add('hidden');
    practiceUi.classList.remove('active');
    practiceUi.classList.add('hidden');

    hud.classList.remove('hidden');

    const modeSelectElement = document.getElementById('mode-select');
    const selectedMode = modeSelectElement ? modeSelectElement.value : 'classic';

    const dictionarySelectElement = document.getElementById('dictionary-select');
    const selectedDictionary = dictionarySelectElement ? dictionarySelectElement.value : 'classic';

    game.start(difficultySelect.value, selectedMode, selectedDictionary);

    // Show Mobile Nova Button
    if (mobileNovaBtn) mobileNovaBtn.classList.remove('mobile-hidden');

    // Focus invisible input to trigger mobile keyboard
    mobileInput.value = ' '; // Space for backspace catching
    mobileInput.focus();
  }

  function updateAudioUI() {
    const vol = game.audio.getMasterVolume();
    const muted = game.audio.isMuted();
    const pctStr = `${Math.round(vol * 100)}%`;

    if (pauseVolumeSlider) pauseVolumeSlider.value = vol;
    if (pauseVolumeVal) pauseVolumeVal.textContent = muted ? 'MUTED' : pctStr;

    const syncBtn = (btn) => {
      if (!btn) return;
      btn.classList.toggle('is-muted', muted);
      const iconOn = btn.querySelector('.sound-icon-on');
      const iconOff = btn.querySelector('.sound-icon-off');
      if (iconOn && iconOff) {
        iconOn.classList.toggle('hidden', muted);
        iconOff.classList.toggle('hidden', !muted);
      }
    };

    syncBtn(pauseMuteBtn);
    syncBtn(hudSoundBtn);
  }

  function togglePause() {
    if (!game.isRunning) return;

    if (game.isPaused) {
      game.resume();
      if (pauseMenu) {
        pauseMenu.classList.remove('active');
        pauseMenu.classList.add('hidden');
      }
    } else {
      if (duelActive) {
        MagicalToast.show("Temporal magic is distorted in the Arena! You cannot freeze time in multiplayer.");
        return;
      }
      if (game.isBossPhase) {
        MagicalToast.show("Temporal magic is distorted during Boss fights! You cannot freeze time.");
        return;
      }
      game.pause();
      updateAudioUI();
      if (pauseMenu) {
        pauseMenu.classList.remove('hidden');
        pauseMenu.classList.add('active');
      }
    }
  }

  function startPractice(skipFocus = false) {
    startMenu.classList.remove('active');
    startMenu.classList.add('hidden');

    practiceUi.classList.remove('hidden');
    practiceUi.classList.add('active');

    scribeHighscoreForm.classList.add('hidden');
    practiceRetryBtn.classList.remove('hidden');
    practiceReturnBtn.classList.remove('hidden');

    practiceBtn.blur();
    practiceRetryBtn.blur();

    const mode = scribeModeSelect.value;
    const duration = parseInt(scribeDurationSelect.value, 10);

    // Show/hide timer element and the associated duration dropdown
    const isTimed = mode === 'timed';
    scribeTimerContainer.classList.toggle('hidden', !isTimed);
    scribeDurationSelect.classList.toggle('hidden', !isTimed);

    scribe.start(mode, duration);

    // Focus invisible input to trigger mobile keyboard, 
    // but skip it if we're just refreshing settings via dropdown
    if (!skipFocus && typeof skipFocus !== 'object') {
      mobileInput.value = ' '; // Space for backspace catching
      mobileInput.focus();
    }
  }

  function quitPractice() {
    scribe.stop();
    game.stop();
    game.reset(); // Clear underlying canvas elements

    // Clear the physical canvas frame to remove static drawings
    const ctx = game.canvas.getContext('2d');
    ctx.clearRect(0, 0, game.canvas.width, game.canvas.height);

    practiceUi.classList.remove('active');
    practiceUi.classList.add('hidden');
    document.getElementById('practice-results').classList.add('hidden');
    startMenu.classList.remove('hidden');
    startMenu.classList.add('active');
  }

  // ── Game Over ─────────────────────────────────────────────────────────────

  game.onGameOver = async (finalStats) => {
    hud.classList.add('hidden');
    // Hide Mobile Nova Button when game ends
    if (mobileNovaBtn) mobileNovaBtn.classList.add('mobile-hidden');

    goScore.innerText = finalStats.score;
    goWords.innerText = finalStats.wordsTyped;
    goWpm.innerText = finalStats.getSessionWPM();
    goAcc.innerText = finalStats.getAccuracy() + '%';
    if (goStreak) goStreak.innerText = finalStats.maxCombo || 0;

    gameOverMenu.classList.remove('hidden');
    gameOverMenu.classList.add('active');
    profileUI.updateMenuStats();

    const qualifies = await leaderboard.isTop10(
      game.difficulty,
      finalStats.score,
      finalStats.getSessionWPM(),
      finalStats.getAccuracy(),
      finalStats.maxCombo || 0
    );

    // Bypassing prompt: auto submit if they have a profile
    if (qualifies && game.stats.mageName) {
      await leaderboard.addScore(
        game.difficulty, // Daily uses 'normal' effectively
        game.stats.mageName,
        finalStats.score,
        finalStats.getSessionWPM(),
        finalStats.getAccuracy(),
        finalStats.maxCombo || 0
      );
    }

    if (game.gameMode === 'daily') {
      const todayStr = new Date().toISOString().split('T')[0];
      const lastCompleted = localStorage.getItem('typerMaster_dailyCompleted');
      if (lastCompleted !== todayStr) {
        localStorage.setItem('typerMaster_dailyCompleted', todayStr);
        game.stats.addXP(500); // Generous daily reward!
        MagicalToast.show("🌟 Daily Challenge Complete! +500 XP Awarded 🌟", 5000);
      } else {
        MagicalToast.show("Daily Challenge Replayed. (Rewards already claimed today)", 3000);
      }
    }

    restartBtn.classList.remove('hidden');
  };

  // ── Unload banking (AT-M8) ───────────────────────────────────────────────
  // A refresh or closed tab used to silently discard an in-flight arena run:
  // no death, no save, nothing in the database. `pagehide` is the modern
  // substitute for `beforeunload` (fires on refresh/close/navigate on desktop
  // AND mobile; beforeunload fires on neither mobile nor bfcache restores).
  //
  // Every write below is a SYNCHRONOUS localStorage enqueue — an unload
  // handler cannot await a network round trip — and the refresh itself
  // reloads the page, which flushes the outbox on load (syncQueue.start()), so
  // the run_history row reaches Supabase ~1s after the reload. Closing the
  // browser instead lands it on the next visit.
  //
  // Scope decisions (documented in PROJECT_STATUS AT-M8):
  //   - Arena (classic/daily/chaos): banked as a death — high score, XP, WPM
  //     ring, local run row, cloud run row, deferred Hall of Fame check.
  //   - Duel: mirrors endDuel's REAL writes exactly (high score + WPM only,
  //     no run_history) — the AT-L5 rule: don't invent writes one path lacks.
  //   - Scribe/practice: NOT banked — game.isRunning is false there anyway.
  //     Its WPM is a rate: banking a 10-second hot streak would let refreshes
  //     farm the boards, while an arena score can never exceed what finishing
  //     the run would have paid.
  //   - bfcache restores (persisted=true): skipped — the page resumes with the
  //     run alive, so there is nothing to bank.
  //   - The daily +500 bonus is not granted here; it still waits for the next
  //     natural death in a daily run (replays are allowed, nothing is lost).
  let unloadBanked = false;

  function bankRunOnUnload() {
    if (unloadBanked) return;

    // Duel ends have their own persistence contract (endDuel): high score +
    // WPM ring only — the shared finaliser encodes exactly that (AT-L5).
    if (duelActive) {
      unloadBanked = true;
      if (game.isRunning) game.stop();
      game.finalizeRun();
      if (game.stats.isAuthenticated) game.stats.queueProfileInsurance();
      return;
    }

    // Menu, results screen, or Scribe's Trial — nothing in flight to bank.
    if (!game.isRunning) return;
    unloadBanked = true;

    const stats = game.stats;
    const wpm = stats.getSessionWPM();
    const accuracy = stats.getAccuracy();
    const score = stats.score;

    game.stop();
    stats.saveHighScore(); // local bests + XP conversion (localStorage first)
    stats.recordWpm(wpm);  // WPM-history ring (AT-M2)
    stats.recordRun({ mode: 'arena', wpm, accuracy, score }); // Recent Runs buffer

    // Cloud half rides the outbox — synchronous enqueue only, no fetch.
    if (stats.isAuthenticated) {
      stats.queueAbandonedRun('arena', wpm, accuracy, score); // run + profile insurance
    }
    // Hall of Fame is name-keyed (guests submit too — same gate as onGameOver).
    if (stats.mageName) {
      leaderboard.queuePendingScore(
        game.difficulty, stats.mageName, score, wpm, accuracy, stats.maxCombo || 0
      );
    }

    // One-shot flag consumed on the next page load: the confirmation toast is
    // the player-visible proof that the refresh did not eat their run.
    try {
      localStorage.setItem('typerMaster_lastRunBanked', JSON.stringify({ score, wpm }));
    } catch (e) { /* ignore */ }
  }

  window.addEventListener('pagehide', (e) => {
    if (e.persisted) return; // bfcache: page resumes with the run intact
    bankRunOnUnload();
  });

  // ── Scribe Trial ──────────────────────────────────────────────────────────

  scribe.onTrialComplete = async (wpm, rawWpm, accuracy, consistency, wpmSamples, maxStreak = 0) => {
    game.stats.recordWpm(wpm);

    // Update accuracy display (already has % in the span)
    const resAcc = document.getElementById('practice-res-acc');
    const resConsistency = document.getElementById('practice-res-consistency');
    if (resAcc) resAcc.innerText = accuracy + '%';
    if (resConsistency) resConsistency.innerText = consistency + '%';

    // Draw WPM graph
    drawWpmGraph(wpmSamples);

    const scribeScore = Math.floor(wpm * (accuracy / 100));

    const qualifies = await leaderboard.isTop10('scribe', scribeScore, wpm, accuracy, maxStreak);

    // Auto submit to leaderboard since we have a mage name
    if (qualifies && game.stats.mageName) {
      await leaderboard.addScore('scribe', game.stats.mageName, scribeScore, wpm, accuracy, maxStreak);
    }

    scribeHighscoreForm.classList.add('hidden');
    practiceRetryBtn.classList.remove('hidden');
    practiceReturnBtn.classList.remove('hidden');
  };

  // ── WPM Graph ─────────────────────────────────────────────────────────────

  function drawWpmGraph(samples) {
    if (!wpmGraphCanvas) return;
    const ctx = wpmGraphCanvas.getContext('2d');
    const W = wpmGraphCanvas.width;
    const H = wpmGraphCanvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = 'rgba(15,10,20,0.9)';
    ctx.fillRect(0, 0, W, H);

    if (!samples || samples.length < 2) {
      ctx.fillStyle = 'rgba(184,146,176,0.4)';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Not enough data', W / 2, H / 2);
      return;
    }

    const pad = { top: 12, right: 12, bottom: 22, left: 36 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top - pad.bottom;

    const maxWpm = Math.max(...samples, 10);
    const minWpm = Math.max(0, Math.min(...samples) - 5);

    const xStep = chartW / (samples.length - 1);
    const toX = (i) => pad.left + i * xStep;
    const toY = (v) => pad.top + chartH - ((v - minWpm) / (maxWpm - minWpm || 1)) * chartH;

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = pad.top + (g / 4) * chartH;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + chartW, y);
      ctx.stroke();

      const label = Math.round(maxWpm - (g / 4) * (maxWpm - minWpm));
      ctx.fillStyle = 'rgba(184,146,176,0.6)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(label, pad.left - 4, y + 3);
    }

    // X-axis: time labels
    ctx.fillStyle = 'rgba(184,146,176,0.5)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    const labelEvery = Math.ceil(samples.length / 6);
    samples.forEach((_, i) => {
      if (i % labelEvery === 0 || i === samples.length - 1) {
        ctx.fillText(`${i + 1}s`, toX(i), H - 4);
      }
    });

    // Gradient fill under the line
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + chartH);
    grad.addColorStop(0, 'rgba(255,215,0,0.25)');
    grad.addColorStop(1, 'rgba(255,215,0,0)');
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(samples[0]));
    samples.forEach((v, i) => ctx.lineTo(toX(i), toY(v)));
    ctx.lineTo(toX(samples.length - 1), pad.top + chartH);
    ctx.lineTo(toX(0), pad.top + chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Gold line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(samples[0]));
    samples.forEach((v, i) => ctx.lineTo(toX(i), toY(v)));
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,215,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Dots at each data point
    ctx.fillStyle = '#ffd700';
    samples.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(toX(i), toY(v), 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ── Leaderboard ───────────────────────────────────────────────────────────

  function openLeaderboard(category = 'score', forceDifficulty = null) {
    startMenu.classList.remove('active');
    startMenu.classList.add('hidden');
    leaderboardMenu.classList.remove('hidden');
    leaderboardMenu.classList.add('active');

    if (forceDifficulty) {
      leaderboardDifficultyFilter.value = forceDifficulty;
    } else if (game.difficulty && leaderboardDifficultyFilter.value !== 'scribe') {
      leaderboardDifficultyFilter.value = game.difficulty;
    }

    renderLeaderboard(category);
  }

  async function renderLeaderboard(category) {
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.category === category);
    });

    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding: 1rem;">Loading Hall of Fame...</td></tr>';

    const difficulty = leaderboardDifficultyFilter.value;
    const scores = await leaderboard.getTopScores(difficulty, category);

    tbody.innerHTML = '';

    if (!scores || scores.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">The Hall of Fame is empty. Create your legacy!</td></tr>';
      return;
    }

    scores.forEach((entry, index) => {
      const tr = document.createElement('tr');
      const rankClass = index === 0 ? 'top-rank' : '';
      const streakVal = entry.streak !== undefined ? entry.streak : 0;
      tr.innerHTML = `
        <td class="col-rank rank-text ${rankClass}">#${index + 1}</td>
        <td class="col-name ${rankClass}">${entry.name}</td>
        <td class="col-score ${category === 'score' ? 'category-highlight' : ''}">${entry.score}</td>
        <td class="col-wpm ${category === 'wpm' ? 'category-highlight' : ''}">${entry.wpm}</td>
        <td class="col-accuracy ${category === 'accuracy' ? 'category-highlight' : ''}">${entry.accuracy}%</td>
        <td class="col-streak ${category === 'streak' ? 'category-highlight' : ''}">${streakVal}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── Event Listeners ───────────────────────────────────────────────────────

  startBtn.addEventListener('click', startGame);
  restartBtn.addEventListener('click', startGame);
  if (resumeBtn) {
    resumeBtn.addEventListener('click', togglePause);
  }
  if (pauseReturnBtn) {
    pauseReturnBtn.addEventListener('click', () => {
      togglePause();
      game.stats.lives = 0;
      game.triggerGameOver();
    });
  }

  // Audio Control Event Listeners
  if (pauseVolumeSlider) {
    pauseVolumeSlider.addEventListener('input', (e) => {
      game.audio.setMasterVolume(parseFloat(e.target.value));
      updateAudioUI();
    });
  }
  if (pauseMuteBtn) {
    pauseMuteBtn.addEventListener('click', () => {
      game.audio.toggleMute();
      updateAudioUI();
    });
  }
  if (hudSoundBtn) {
    hudSoundBtn.addEventListener('click', () => {
      game.audio.toggleMute();
      updateAudioUI();
    });
  }
  updateAudioUI();
  if (returnDashboardBtn) {
    returnDashboardBtn.addEventListener('click', () => {
      game.stop();
      game.reset();
      const ctx = game.canvas.getContext('2d');
      ctx.clearRect(0, 0, game.canvas.width, game.canvas.height);

      gameOverMenu.classList.add('hidden');
      gameOverMenu.classList.remove('active');
      startMenu.classList.remove('hidden');
      startMenu.classList.add('active');
    });
  }
  practiceBtn.addEventListener('click', () => startPractice());
  practiceReturnBtn.addEventListener('click', quitPractice);
  practiceRetryBtn.addEventListener('click', () => startPractice());

  openLeaderboardBtn.addEventListener('click', () => {
    openLeaderboard('score');
  });

  closeLeaderboardBtn.addEventListener('click', () => {
    leaderboardMenu.classList.remove('active');
    leaderboardMenu.classList.add('hidden');
    startMenu.classList.remove('hidden');
    startMenu.classList.add('active');
  });

  const mageAvatarBg = document.getElementById('background-mage');

  /**
   * AT-F13: dim #start-menu when a submenu is open over it, without an ancestor
   * `filter`. The old code wrote `startMenu.style.filter = 'blur(4px)'`, and a
   * CSS filter on the ancestor of a composited panel forces the browser to
   * re-rasterise the WHOLE start menu — plus the arena panel sliding in over it —
   * on every frame of the transition. That is the owner's "still too laggy in
   * production" report; `.menu-behind` is an opacity + scrim treatment the
   * compositor handles for free.
   *
   * The inline `filter` is also explicitly cleared: a cached build could have
   * left one set, and `filter: none` alone did not always win over it.
   *
   * NOTE: main.js's keyboard quick-start guard used to detect "a submenu is open"
   * by string-comparing `startMenu.style.filter`; it now checks this class (the
   * string check is kept as a belt-and-braces fallback — see the keydown handler).
   */
  function setMenuBehind(behind) {
    startMenu.classList.toggle('menu-behind', behind);
    startMenu.style.pointerEvents = behind ? 'none' : 'auto';
    startMenu.style.opacity = behind ? '0.5' : '';
    startMenu.style.filter = '';
  }

  if (mageAvatarBg) {
    mageAvatarBg.addEventListener('click', () => {
      // Populate profile display using local variables already in scope
      if (authUI.profileUsernameUI) {
        authUI.profileUsernameUI.innerText = isGuest() ? 'Wandering Guest' : (authUI.profileUsernameUI.innerText || 'Unknown Mage');
      }
      if (authUI.profileNickname) {
        authUI.profileNickname.innerText = game.stats.mageName || 'Unknown Mage';
      }

      profileUI.updateMenuStats();
      paintSkinPreviews(); // a font swap can invalidate the baked previews
      updateForgeUI();

      setMenuBehind(true);

      authUI.profileMenu.classList.remove('hidden');
      setTimeout(() => authUI.profileMenu.classList.add('active'), 10);
    });
  }

  // ── AT-F16: the Forge — characters bought with Arcane XP ──────────────────
  // Prices, names and colours come from `Characters.js` (the same table
  // CharacterRenderer switches on) and the previews are painted by the very call
  // the arena makes, so a card can never sell art the game does not have.
  const skinCards = Array.from(document.querySelectorAll('#character-skin-grid .skin-card'));

  function paintSkinPreview(canvas, characterId) {
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    // The sprite spans ~67px around its anchor; this 0.8 scale and anchor keep the
    // whole silhouette (halo included) inside the 160×72 strip at 0 combo.
    ctx.translate(canvas.width / 2, 52);
    ctx.scale(0.8, 0.8);
    CharacterRenderer.draw(ctx, 0, 0, characterId, 0, { combo: 0, wandColor: '#ffd700', hasSkill: () => false }, 0);
    ctx.restore();
  }

  function paintSkinPreviews() {
    skinCards.forEach(card => paintSkinPreview(card.querySelector('.skin-preview'), card.dataset.char));
  }

  /**
   * Repaints the Forge from the roster + Stats: owned → selectable, equipped →
   * `.active`, unowned → its price read from the table (never from markup).
   */
  function updateForgeUI() {
    skinCards.forEach(card => {
      const id = card.dataset.char;
      const info = characterInfo(id);
      const owned = game.stats.isCharacterUnlocked(id);
      const equipped = game.stats.selectedCharacter === id;
      const status = card.querySelector('.skin-status');

      card.classList.toggle('locked', !owned);
      card.classList.toggle('active', equipped);
      card.style.cursor = owned ? 'pointer' : 'not-allowed';
      card.title = owned
        ? (equipped ? `${info.title} — equipped` : `Equip ${info.title}`)
        : `Coming Soon: ${info.blurb}`;

      if (status) {
        status.innerText = equipped ? 'Equipped'
          : owned ? 'Unlocked'
            : `FORGE ${info.unlockPrice.toLocaleString()} XP`;
      }
    });
  }

  skinCards.forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.char;
      const info = characterInfo(id);

      if (needsMageCard()) {
        MagicalToast.show(`The Forge needs a sealed Mage Card!<br><span style='font-size: 0.8em; color: var(--text-muted);'>Log in or register to forge ${info.title}.</span>`);
        return;
      }

      if (!game.stats.isCharacterUnlocked(id)) {
        // The price is enforced inside Stats.purchaseCharacter (from the table),
        // so a tampered card price buys nothing.
        if (!game.stats.purchaseCharacter(id)) {
          MagicalToast.show(`Not enough Arcane XP for ${info.title}.<br><span style='font-size: 0.8em; color: var(--text-muted);'>${info.unlockPrice.toLocaleString()} XP required.</span>`);
          return;
        }
        game.audio.playExplosion();
        MagicalToast.show(`${info.title} forged!<br><span style='font-size: 0.8em; color: var(--text-muted);'>Click the card again to equip it.</span>`);
        updateForgeUI();
        return;
      }

      if (game.stats.setSelectedCharacter(id)) {
        MagicalToast.show(`${info.title} equipped.`);
        updateForgeUI();
      }
    });
  });

  // AT-M9b: paint at BOOT. `paintSkinPreviews` existed but nothing ever called
  // it, so the shipped Forge showed three blank strips until the profile was
  // opened — a painter without a caller is a promise the player never sees. The
  // source-level guards could not see this (the code was correct and unused); a
  // live Chrome pass read the canvases and found zero painted pixels.
  // `updateForgeUI` runs here too, so the prices are on the cards before the
  // panel is ever opened.
  paintSkinPreviews();
  updateForgeUI();

  const closeProfileBtn = document.getElementById('close-profile-btn');
  if (closeProfileBtn) {
    closeProfileBtn.addEventListener('click', () => {
      authUI.profileMenu.classList.remove('active');
      authUI.profileMenu.classList.add('hidden');

      setMenuBehind(false);
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      // Every key that belongs to THIS mage, including the ones the old
      // hand-written list missed (best streak, daily reward, level) plus the
      // offline outbox and the per-browser Hall of Fame cache. Without this the
      // next account on this browser inherited the previous mage's identity.
      game.stats.clearLocalProgression();

      try {
        if (supabase) {
          await supabase.auth.signOut();
        }
      } catch (e) {
        console.warn("Failed to sign out from Supabase", e);
      }

      // Reload window to return to fresh state
      window.location.reload();
    });
  }


  forfeitBtn.addEventListener('click', () => {
    // Instantly drain lives and trigger game over logic
    game.stats.lives = 0;
    game.triggerGameOver();
  });




  // Workshop Listeners
  workshopBtn.addEventListener('click', () => {
    if (needsMageCard()) {
      MagicalToast.show("The Workshop requires a sealed Mage Card!<br><span style='font-size: 0.8em; color: var(--text-muted);'>Please log in or register to unlock upgrades.</span>");
      return;
    }
    startMenu.classList.remove('active');
    startMenu.classList.add('hidden');
    workshopMenu.classList.remove('hidden');
    workshopMenu.classList.add('active');
    updateWorkshopUI();
  });

  closeWorkshopBtn.addEventListener('click', () => {
    workshopMenu.classList.remove('active');
    workshopMenu.classList.add('hidden');
    startMenu.classList.remove('hidden');
    startMenu.classList.add('active');

    // AT-F13: hand the menu back (there is no ancestor filter to unwind now)
    setMenuBehind(false);
  });

  // ── Mage Duels ─────────────────────────────────────────────────────────────

  function openDuelLobby() {
    setMenuBehind(true);

    // Using a setTimeout allows display: flex to apply before we trigger the CSS transition
    setTimeout(() => {
      duelLobbyMenu.classList.add('active');
    }, 10);

    duelLobbyIdlePanel.style.display = 'flex';
    duelLobbyWaitingPanel.style.display = 'none';
    duelLobbyError.innerText = '';
  }

  // Duel button on Start Menu
  const duelMageSilhouette = document.getElementById('duel-mage');
  if (duelMageSilhouette) {
    duelMageSilhouette.addEventListener('click', () => {
      if (needsMageCard()) {
        MagicalToast.show("The Arena requires a sealed Mage Card!<br><span style='font-size: 0.8em; color: var(--text-muted);'>Please log in or register to duel other mages.</span>");
        return;
      }
      if (!supabase) {
        MagicalToast.show("The Arena requires a Supabase connection.<br><span style='font-size: 0.8em; color: var(--text-muted);'>Please configure your environment variables.</span>");
        return;
      }
      duelLobbyMenu.classList.remove('hidden');
      openDuelLobby();
    });
  }
  function closeDuelLobby() {
    if (duel) { duel.disconnect(); duel = null; }
    setMenuBehind(false);

    duelLobbyMenu.classList.remove('active');
    duelLobbyMenu.classList.add('hidden');
    startMenu.classList.remove('hidden');
    startMenu.classList.add('active');
  }

  function startDuel(opponentName) {
    duelActive = true;
    // Room lock (AT-F9): flag this presence so a third client cannot join
    // a match that is already running.
    if (duel) duel.markInMatch();

    // Dimension shift immediately
    document.body.classList.add('duel-dimension');

    // Close lobby, hide library dashboard, show game HUD
    duelLobbyMenu.classList.remove('active');
    duelLobbyMenu.classList.add('hidden');
    startMenu.classList.remove('active');
    startMenu.classList.add('hidden');
    // Score bar is shown by DuelRace.start() when the countdown hits FIGHT.

    // Override game over: in duel mode, forfeit ends the match (AT-F9).
    // Keep the survival death screen so endDuel can hand it back.
    if (!survivalGameOver) survivalGameOver = game.onGameOver;
    game.onGameOver = () => endDuel(false, 'forfeit');

    // Sabotage (blind/swarm) is OUT of the arena — AT-F9 v1.

    // 3.. 2.. 1.. FIGHT overlay
    const countdownOverlay = document.createElement('div');
    countdownOverlay.style.position = 'absolute';
    countdownOverlay.style.inset = '0';
    countdownOverlay.style.display = 'flex';
    countdownOverlay.style.alignItems = 'center';
    countdownOverlay.style.justifyContent = 'center';
    countdownOverlay.style.background = 'rgba(0,0,0,0.7)';
    countdownOverlay.style.zIndex = '2000';
    document.getElementById('game-container').appendChild(countdownOverlay);

    const countdownText = document.createElement('h1');
    countdownText.style.fontSize = '8rem';
    countdownText.style.color = '#fff';
    countdownText.style.textShadow = '0 0 30px #29b6f6';
    countdownOverlay.appendChild(countdownText);

    let count = 3;
    countdownText.innerText = count;

    const countInterval = setInterval(() => {
      count--;
      if (count > 0) {
        countdownText.innerText = count;
      } else if (count === 0) {
        countdownText.innerText = 'FIGHT!';
        countdownText.style.color = '#ff4b4b';
        countdownText.style.textShadow = '0 0 40px #ff4b4b';
      } else {
        clearInterval(countInterval);
        countdownOverlay.remove();
        duelCountdown = null;

        // The duel can already be over before FIGHT — endDuel ran mid-count and
        // cleared `duel`. Abort instead of building a race against null (the
        // owner-reported `Cannot read properties of null (reading 'isHost')`).
        if (!duel || !duelActive) return;

        // --- START THE REAL MATCH HERE ---
        // AT-F9: difficulty/mode/dictionary pinned — both clients identical.
        // AT-L7 (decided 2026-09-23: PINNED, intentional fairness). The host's
        // selectors would silently govern BOTH players' word pool — the host
        // could pick easy words/difficulty and the challenger has no say — so
        // the arena draws from neutral 'normal'/'classic' for everyone. mode
        // MUST stay 'duel': it gates the race hooks and the spawn path. A frame
        // already carries the word text, so nothing else needs to match. Do not
        // "fix" this by passing difficultySelect/selectedMode/selectedDictionary
        // here — `npm run verify:polish` locks it.
        game.start('normal', 'duel', 'classic');
        hud.classList.remove('hidden');
        // Survival boxes with no arena meaning (HP lives in the score bar) —
        // also clears overlap room. There is no SPEED box to hide any more:
        // AT-F12 deleted it from the markup outright (Survival and PvP alike).
        document.querySelector('.stat-barriers')?.classList.add('hidden');
        document.getElementById('wave-stat')?.classList.add('hidden');

        race = new DuelRace({
          game,
          duel,
          isHost: duel.isHost,
          opponentName,
          onMatchEnd: (won, reason) => endDuel(won, reason)
        });
        race.start();
      }
    }, 1000);

    // Registered after setInterval: the first tick cannot fire before this line
    // runs (single-threaded), and endDuel needs the handle to kill it.
    duelCountdown = { interval: countInterval, overlay: countdownOverlay };
  }

  function endDuel(isWinner, reason = '') {
    if (!duelActive) return;
    duelActive = false;

    // Kill a live countdown: endDuel can fire mid-count (the opponent left while
    // 3..2..1 ran), and the interval would otherwise reach FIGHT and dereference
    // the cleared `duel` — the owner-reported TypeError at `duel.isHost`.
    if (duelCountdown) {
      clearInterval(duelCountdown.interval);
      duelCountdown.overlay.remove();
      duelCountdown = null;
    }

    // Race controller: capture its summary, tell the opponent when WE quit,
    // then tear down timers/hooks (presence grace covers their quit).
    let raceWins = { mine: 0, theirs: 0 };
    let forfeitFlush = null;
    if (race) {
      raceWins = race.summary();
      if (!race.over) forfeitFlush = race.announceForfeit(); // Promise → flush below
      race.stop();
      race = null;
    }
    game.onAttackCast = null;
    // AT-F10: the race owns the arena's cast press and nulls this in stop();
    // clearing it here too means a duel that ends before stop() can never leave
    // Tab routed into a dead race (the survival ultimate must keep working).
    game.onDuelCast = null;

    // Hand the survival death screen back to the menu path (AT-F9): startDuel
    // swapped the hook, and a hook left pointing at endDuel would silently stall
    // every survival death from here on (endDuel early-returns when idle).
    if (survivalGameOver) game.onGameOver = survivalGameOver;

    // Stop underlying game if still running
    if (game.isRunning) game.stop();

    // Shared persistence (AT-L5): high score + WPM, exactly once — the same
    // writes triggerGameOver and the unload bank route through.
    game.finalizeRun();

    // Flush the forfeit/match_over frame before tearing the channel down —
    // removeChannel can kill an unsent broadcast, leaving the opponent
    // narrating 'vanished' for a clean UI quit (owner-reported AT-F9 bug).
    const parting = duel;
    duel = null;
    if (parting) {
      if (forfeitFlush) {
        Promise.race([forfeitFlush, new Promise(res => setTimeout(res, 250))])
          .then(() => parting.disconnect(), () => parting.disconnect());
      } else {
        parting.disconnect();
      }
    }

    // Hide game UI & revert dimensions; restore survival-only boxes
    // (no SPEED box to restore — AT-F12 removed it from the markup)
    document.body.classList.remove('duel-dimension');
    hud.classList.add('hidden');
    document.querySelector('.stat-barriers')?.classList.remove('hidden');
    document.getElementById('wave-stat')?.classList.remove('hidden');
    document.getElementById('duel-scorebar')?.classList.add('hidden');

    // Result screen — race wins as the headline numbers (AT-F9)
    duelResMyScore.innerText = raceWins.mine;
    duelResOppScore.innerText = raceWins.theirs;

    if (isWinner) {
      duelResultTitle.innerText = '⚔️ VICTORY!';
      duelResultTitle.style.color = '#ffd700';
      duelResultSubtitle.innerText =
        reason === 'disconnect' ? 'Your opponent vanished mid-cast!' :
        reason === 'forfeit'   ? 'Your opponent yielded the duel!' :
        reason === 'time'      ? 'Time! Your ward outlasted theirs.' :
        reason === 'overtime'  ? 'Sudden death — the final strike landed!' :
                                 'You have vanquished your foe!';
    } else {
      duelResultTitle.innerText = '💀 DEFEATED';
      duelResultTitle.style.color = '#ff4b4b';
      duelResultSubtitle.innerText =
        reason === 'disconnect' ? 'Connection lost — the duel is conceded.' :
        reason === 'forfeit'   ? 'You yielded the duel.' :
        reason === 'time'      ? 'Time expired — their ward held.' :
        reason === 'overtime'  ? 'Sudden death — the final strike found you.' :
                                 'Your arcane ward has shattered...';
    }

    duelResultMenu.classList.remove('hidden');
    duelResultMenu.classList.add('active');
  }

  // Duel button on Start Menu (duplicate listener block — removed, handled by duelMageSilhouette above)

  // Close lobby
  document.getElementById('duel-lobby-close-btn').addEventListener('click', closeDuelLobby);

  // Create room
  document.getElementById('duel-create-btn').addEventListener('click', async () => {
    if (!game.stats.mageName) {
      duelLobbyError.innerText = 'You must be logged in to create a duel.';
      return;
    }
    duelLobbyError.innerText = '';
    duel = new Duel(supabase, game.stats.mageName);
    duel.setCharacter(game.stats.selectedCharacter, game.stats.wandColor, game.stats.mageClass);

    duel.onOpponentJoined = () => {
      // Room lock belt-and-suspenders: a third presence joining mid-match
      // must never re-fire startDuel (AT-F9). A presence re-track pairs a
      // `leave` with this `join`, so refuse once `duel` has been torn down too.
      if (!duel || duelActive) return;
      // Read the opponent's display name from the presence payload
      const state = duel.channel.presenceState();
      const opponentPresenceKey = Object.keys(state).find(k => k !== duel.presenceKey);
      let opponentName = 'Unknown Mage';
      if (opponentPresenceKey) {
        const presences = state[opponentPresenceKey];
        opponentName = presences?.[0]?.player_name || 'Unknown Mage';
      }
      startDuel(opponentName);
    };

    // Opponent STATE is owned by DuelRace during the match (AT-F9); pre-FIGHT
    // departures go through the shared presence check (a re-track's transient
    // `leave` must not end the duel mid-countdown).
    duel.onOpponentLeft = () => onLobbyOpponentLeft();

    const code = await duel.create();
    duelRoomCodeDisplay.innerText = code;
    duelLobbyIdlePanel.style.display = 'none';
    duelLobbyWaitingPanel.style.display = 'flex';
  });

  // Join room
  document.getElementById('duel-join-btn').addEventListener('click', async () => {
    const code = duelRoomInput.value.trim().toUpperCase();
    if (code.length < 6) {
      duelLobbyError.innerText = 'Please enter a valid 6-character room code.';
      return;
    }
    if (!game.stats.mageName) {
      duelLobbyError.innerText = 'You must be logged in to join a duel.';
      return;
    }
    duelLobbyError.innerText = 'Joining room ' + code + '...';
    duel = new Duel(supabase, game.stats.mageName);
    duel.setCharacter(game.stats.selectedCharacter, game.stats.wandColor, game.stats.mageClass);

    // Opponent STATE is owned by DuelRace during the match (AT-F9); pre-FIGHT
    // departures go through the shared presence check (a re-track's transient
    // `leave` must not end the duel mid-countdown).
    duel.onOpponentLeft = () => onLobbyOpponentLeft();

    const hostKey = await duel.join(code);
    if (hostKey === null) {
      // Room locked — the match behind this code is already running (AT-F9).
      duelLobbyError.innerText = 'That match is already in progress. Try again after it ends.';
      await duel.disconnect();
      duel = null;
      return;
    }
    duelLobbyError.innerText = '';

    startDuel(hostKey);
  });

  // Rematch — re-open lobby
  document.getElementById('duel-rematch-btn').addEventListener('click', () => {
    game.stop();
    game.reset();

    const ctx = game.canvas.getContext('2d');
    ctx.clearRect(0, 0, game.canvas.width, game.canvas.height);

    duelResultMenu.classList.remove('active');
    duelResultMenu.classList.add('hidden');
    openDuelLobby();
  });

  // Return to Library from result screen
  document.getElementById('duel-result-close-btn').addEventListener('click', () => {
    game.stop();
    game.reset(); // Clear underlying canvas elements

    // Clear the physical canvas frame to remove static drawings
    const ctx = game.canvas.getContext('2d');
    ctx.clearRect(0, 0, game.canvas.width, game.canvas.height);

    duelResultMenu.classList.remove('active');
    duelResultMenu.classList.add('hidden');
    startMenu.classList.remove('hidden');
    startMenu.classList.add('active');

    // AT-F13: hand the menu back (there is no ancestor filter to unwind now)
    setMenuBehind(false);

    profileUI.updateMenuStats();
  });

  // ── Mystic Arts talent tree (AT-L8 / AT-F10) ──────────────────────────────
  const talentBranches = document.querySelectorAll('.talent-branch');

  /**
   * Paint the four Discipline branch headers from the ONE roster
   * (backend/MageClasses.js) and mark which one the mage has actually bound.
   * The tree's three headers used to be hand-written HTML naming Scholar /
   * Pyromancer / Oracle, and only Pyromancer existed anywhere else in the
   * project — so the Workshop disagreed with the profile picker (AT-L8).
   *
   * Node ids and XP costs stay in index.html: this only writes the header text,
   * the accent colour and the `bound` class, and it re-writes the text only when
   * the bound class changed, so a purchase click stays cheap.
   */
  function buildTalentTree() {
    const boundInfo = mageClassInfo(game.stats ? game.stats.mageClass : null);

    talentBranches.forEach(branch => {
      const head = branch.querySelector('.talent-branch-head');
      if (!head) return;
      const info = mageClassInfo(branch.dataset.class);

      const stale = head.dataset.class !== info.id;
      if (stale) {
        head.innerHTML =
          `<span class="talent-branch-title">The ${info.title}</span>` +
          `<span class="talent-branch-tagline">${info.tagline}</span>`;
        head.style.setProperty('--branch-accent', info.color);
        head.style.setProperty('--branch-glow', `${info.color}80`);
        head.dataset.class = info.id;
      }

      branch.classList.toggle('bound', info.id === boundInfo.id);
      branch.title = info.blurb;
    });
  }

  function updateWorkshopUI() {
    buildTalentTree();

    workshopXp.innerText = game.stats.totalXP;
    workshopLevel.innerText = game.stats.playerLevel;

    // Update skills
    skillNodes.forEach(node => {
      const skillId = node.id.replace('skill-', '').replace('-btn', '');
      if (game.stats.hasSkill(skillId)) {
        node.classList.remove('locked');
        node.classList.add('unlocked');
      } else {
        node.classList.remove('unlocked');
        const cost = parseInt(node.dataset.cost, 10);
        if (game.stats.totalXP >= cost) {
          node.classList.remove('locked');
        } else {
          node.classList.add('locked');
        }
      }
    });

    // Update wands
    wandBtns.forEach(btn => {
      if (btn.dataset.color === game.stats.wandColor) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Headers are static per class, so paint them once at startup (the menu is
  // hidden until then); updateWorkshopUI() only re-marks the bound branch.
  buildTalentTree();

  skillNodes.forEach(node => {
    node.addEventListener('click', () => {
      const skillId = node.id.replace('skill-', '').replace('-btn', '');
      if (game.stats.hasSkill(skillId)) return; // Already unlocked

      const cost = parseInt(node.dataset.cost, 10);
      if (game.stats.spendXP(cost)) {
        game.stats.unlockSkill(skillId);
        updateWorkshopUI();

        // Play purchase sound
        game.audio.playExplosion();
      }
    });
  });

  wandBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      game.stats.setWandColor(color);
      updateWorkshopUI();
    });
  });

  tabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => renderLeaderboard(e.target.dataset.category));
  });

  leaderboardDifficultyFilter.addEventListener('change', () => {
    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab) renderLeaderboard(activeTab.dataset.category);
  });

  window.addEventListener('keydown', (e) => {
    // Keyboard quick-start: Enter to begin from start menu
    if (e.key === 'Enter' && startMenu.classList.contains('active') && !startMenu.classList.contains('hidden') && !startMenu.classList.contains('menu-behind') && startMenu.style.filter !== 'blur(4px)') {
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      if (activeTag !== 'BUTTON' && activeTag !== 'SELECT' && activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        e.preventDefault();
        startGame();
        return;
      }
    }

    // Dismiss any active magical toasts instantly
    if (e.key === 'Escape') {
      const toastContainer = MagicalToast.toastContainer;
      if (toastContainer && toastContainer.children.length > 0) {
        MagicalToast.clearAll();
        return;
      }
    }

    // If the Duel Lobby is active, Escape closes it and unblurs the dashboard
    if (e.key === 'Escape' && duelLobbyMenu.classList.contains('active')) {
      closeDuelLobby();
      return;
    }

    // Toggle pause/resume during active gameplay
    if (e.key === 'Escape' && game.isRunning) {
      togglePause();
      return;
    }

    if (scribe.isRunning) {
      if (e.key === 'Escape') {
        quitPractice();
        return;
      }

      // Stop the event from propagating to the hidden mobile input on Desktop
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.preventDefault) e.preventDefault();
      }

      scribe.handleKeyDown(e);
    }
  });

  // ── Mobile Support ────────────────────────────────────────────────────────

  // Ensure mobile keyboard stays open or re-opens if they tap the screen while playing
  document.addEventListener('touchstart', (e) => {
    // Only intercept if we are actively playing and NOT touching a UI button or dropdown
    const ignoreTags = ['BUTTON', 'SELECT', 'OPTION'];
    if ((game.isRunning || scribe.isRunning) && !ignoreTags.includes(e.target.tagName)) {
      // Small timeout helps bypass iOS Safari's aggressive focus blocking
      setTimeout(() => {
        mobileInput.focus();
      }, 50);
    }
  });

  document.addEventListener('click', (e) => {
    const ignoreTags = ['BUTTON', 'SELECT', 'OPTION'];
    if ((game.isRunning || scribe.isRunning) && !ignoreTags.includes(e.target.tagName)) {
      mobileInput.focus();
    }
  });

  mobileInput.addEventListener('input', (e) => {
    if (!game.isRunning && !scribe.isRunning) return;

    let char = null;

    // Check if backspace was pressed on mobile software keyboard
    if (e.inputType === 'deleteContentBackward') {
      char = 'Backspace';
    } else if (e.data && e.data.length === 1) {
      char = e.data.toLowerCase();
    } else if (mobileInput.value && mobileInput.value.length > 0) {
      // Fallback if e.data is missing but the value grew
      char = mobileInput.value.slice(-1).toLowerCase();
    }

    if (char) {
      const syntheticEvent = {
        key: char,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        preventDefault: () => { }
      };

      if (game.isRunning) {
        game.inputHandler.handleKeyDown(syntheticEvent);
      } else if (scribe.isRunning) {
        scribe.handleKeyDown(syntheticEvent);
      }
    }

    // Always keep a space in the input so soft keyboards will emit 'deleteContentBackward' when Backspace is hit
    mobileInput.value = ' ';
  });

  // Mobile Ultimate Button
  const castNovaMobile = (e) => {
    e.preventDefault(); // prevent double-trigger from click if touchstart fires first
    if (game.isRunning) {
      game.combatSystem.castUltimateSpell();
      // Keep focus on the typing field after casting
      mobileInput.focus();
    }
  };

  mobileNovaBtn.addEventListener('click', castNovaMobile);
  mobileNovaBtn.addEventListener('touchstart', castNovaMobile);

});
