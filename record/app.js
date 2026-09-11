// ---------------------------------------------------------------
// Dev-mode URL switch — for mobile, where opening DevTools isn't
// practical. Visiting ?dev=1&key=<dev anon key> once sets the same
// localStorage override the console method below would, then cleans
// the URL so the key doesn't linger in the address bar. Save a URL
// like this as a home-screen bookmark/icon (e.g. named "Matchday DEV")
// and tapping it switches into dev mode with no typing required.
// ?dev=0 clears the override back to prod (no key needed for that).
// ---------------------------------------------------------------
(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has("dev")) return;
  if (params.get("dev") === "0") {
    localStorage.removeItem("dev_supabase_url");
    localStorage.removeItem("dev_supabase_anon_key");
  } else {
    const key = params.get("key");
    if (key) {
      localStorage.setItem("dev_supabase_url", "https://matchday-api-dev.shadowlan.org");
      localStorage.setItem("dev_supabase_anon_key", key);
    }
  }
  params.delete("dev");
  params.delete("key");
  history.replaceState({}, "", location.pathname + (params.toString() ? "?" + params.toString() : ""));
})();

// ---------------------------------------------------------------
// CONFIG — points at the self-hosted backend (see self-host/README.md).
// Falls back to a dev backend when set via the URL switch above or the
// browser console, so you can test against
// matchday-api-dev.shadowlan.org without ever editing or committing
// this file:
//   localStorage.setItem("dev_supabase_url", "https://matchday-api-dev.shadowlan.org");
//   localStorage.setItem("dev_supabase_anon_key", "<dev anon key>");
//   location.reload();
// To switch back: localStorage.removeItem("dev_supabase_url"),
// localStorage.removeItem("dev_supabase_anon_key"), reload.
// ---------------------------------------------------------------
const CONFIG = {
  TEAM_NAME: "Wyrley Rockets",
  SUPABASE_URL: localStorage.getItem("dev_supabase_url") || "https://matchday-api.shadowlan.org",
  SUPABASE_ANON_KEY: localStorage.getItem("dev_supabase_anon_key") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNoZGF5LXNlbGYtaG9zdCIsImlhdCI6MTc4OTExOTc2MSwiZXhwIjoyMTA0Njk1NzYxfQ.L9_Tlu6kLFrjv-EUFrGTl6i2yUNCWopLyX0gkSJS9S8",  // your anon/public key
};

// Single dedicated goalkeeper — the Save button logs straight to them
// without asking who made the save. Update this if that ever changes
// (e.g. a second keeper rotates in).
const GOALKEEPER_NAME = "Reon";

// ---------------------------------------------------------------
// Dev-mode indicator — impossible to miss, so it's never ambiguous
// which backend you're actually talking to. Uses only the existing
// black/white/grey palette + dashed-border motif, no new accent colour.
// ---------------------------------------------------------------
if (localStorage.getItem("dev_supabase_url")) {
  const devBadge = document.createElement("div");
  devBadge.textContent = "DEV MODE";
  devBadge.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:99999;" +
    "background:#161616;color:#ffffff;text-align:center;padding:4px 0;" +
    "font:bold 12px/1.4 'Courier New',monospace;letter-spacing:2px;" +
    "border-bottom:2px dashed #3d3d3d;";
  document.body.appendChild(devBadge);
}

// ---------------------------------------------------------------
// Storage helpers (localStorage is fine here — a season's worth
// of matches/events is tiny, well under the 5MB-ish browser limit)
// ---------------------------------------------------------------
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
};

// ---------------------------------------------------------------
// Auth (Supabase email/password, single shared coach account)
// ---------------------------------------------------------------
function getSession() {
  return store.get("auth_session", null);
}

function setSession(tokenResponse) {
  const session = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    expires_at: Date.now() + tokenResponse.expires_in * 1000,
  };
  store.set("auth_session", session);
  return session;
}

function clearSession() {
  localStorage.removeItem("auth_session");
}

async function signIn(email, password) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || "Invalid email or password");
  }
  return setSession(data);
}

async function refreshSession(refreshToken) {
  let res;
  try {
    res = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch {
    throw Object.assign(new Error("network"), { definite: false });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.msg || data.error_description || "refresh_failed"), { definite: true });
  }
  return setSession(await res.json());
}

// Never throws. A network failure keeps the stale session (so the
// recorder keeps working offline pitch-side); only a server-confirmed
// rejection of the refresh_token clears the session.
async function ensureFreshSession() {
  const session = getSession();
  if (!session) return null;
  if (session.expires_at - 60_000 > Date.now()) return session;
  try {
    return await refreshSession(session.refresh_token);
  } catch (err) {
    if (err.definite) {
      clearSession();
      return null;
    }
    return session;
  }
}

// ---------------------------------------------------------------
// Squad (player profiles) — persists across matches on this device
// ---------------------------------------------------------------
let squad = store.get("squad", []); // [{ id, name, number }]
let match = null;       // current match object while live
let clockInterval = null;
let pendingAction = null; // resolves the currently-open player picker
let selectedAwardPlayer = null; // player name chosen via the picker, for the awards form

function saveSquad() {
  store.set("squad", squad);
  renderSquadList();
  updateSquadCountBadge();
}

function renderSquadList() {
  const list = document.getElementById("squad-list");
  const empty = document.getElementById("squad-empty");
  if (!list) return;
  list.innerHTML = "";
  if (!squad.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  squad
    .slice()
    .sort((a, b) => (a.number ?? 99) - (b.number ?? 99))
    .forEach((p) => {
      const row = document.createElement("div");
      row.className = "squad-item";
      row.innerHTML = `
        <span class="number-badge">${p.number ?? "-"}</span>
        <span class="player-name">${p.name}</span>
        <button class="remove-btn" data-id="${p.id}">remove</button>
      `;
      list.appendChild(row);
    });
  list.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      squad = squad.filter((p) => p.id !== btn.dataset.id);
      saveSquad();
    });
  });
}

function updateSquadCountBadge() {
  const badge = document.getElementById("squad-count-badge");
  if (badge) badge.textContent = `(${squad.length} player${squad.length === 1 ? "" : "s"})`;
}

// ---------------------------------------------------------------
// Pull the squad down from Supabase's `players` table on login/boot,
// so a coach signing in on a new device doesn't have to re-type
// everyone. Merges by name — updates shirt numbers for players that
// already exist locally, adds ones that don't, and never removes a
// locally-added player who just hasn't synced yet (e.g. hasn't been
// involved in a recorded event, so resolvePlayerId hasn't created
// their `players` row on the server side yet).
// ---------------------------------------------------------------
async function syncSquadFromSupabase(session) {
  try {
    const headers = {
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    };
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/players?active=eq.true&select=name,squad_number&order=squad_number.asc`,
      { headers }
    );
    if (!res.ok) return;
    const remotePlayers = await res.json();

    const byName = new Map(squad.map((p) => [p.name, p]));
    let changed = false;
    for (const rp of remotePlayers) {
      const local = byName.get(rp.name);
      if (local) {
        if (local.number !== rp.squad_number) {
          local.number = rp.squad_number;
          changed = true;
        }
      } else {
        squad.push({ id: crypto.randomUUID(), name: rp.name, number: rp.squad_number });
        changed = true;
      }
    }
    if (changed) {
      store.set("squad", squad);
      renderSquadList();
      updateSquadCountBadge();
    }
  } catch (err) {
    console.error("Squad sync from Supabase failed:", err);
  }
}

// ---------------------------------------------------------------
// Awards (Training/Manager's/Parents' Player of the Week, Player of
// the Month) — none of these are tied to a specific match; the two
// "Player of the Match" awards are actually decided weekly on the
// strength of both weekend matches combined, same cadence as the
// training award, so there's just a period_date (week-ending Sunday,
// or first-of-month) rather than a match reference.
// ---------------------------------------------------------------
const AWARD_LABELS = {
  training_potw: "Training POTW",
  managers_potw: "Manager's POTW",
  parents_potw: "Parents' POTW",
  player_of_month: "Player of the Month",
};

function mostRecentSunday() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay()); // getDay(): 0 = Sunday
  return d;
}

function updateAwardPeriodInputs() {
  const isMonthly = document.getElementById("award-type").value === "player_of_month";
  document.getElementById("award-period-date").classList.toggle("hidden", isMonthly);
  document.getElementById("award-period-month").classList.toggle("hidden", !isMonthly);
  document.getElementById("award-period-label").textContent = isMonthly ? "Month" : "Week ending";
}

function resetAwardForm() {
  selectedAwardPlayer = null;
  document.getElementById("award-player-btn").textContent = "Select player →";
  document.getElementById("award-period-date").valueAsDate = mostRecentSunday();
  document.getElementById("award-period-month").value = new Date().toISOString().slice(0, 7);
}

async function renderAwardsList() {
  const list = document.getElementById("awards-list");
  const empty = document.getElementById("awards-empty");
  if (!list) return;
  const session = await ensureFreshSession();
  if (!session) return;
  try {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/season_awards?select=award_type,period_date,player_name&order=period_date.desc&limit=10`,
      {
        headers: {
          apikey: CONFIG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    );
    if (!res.ok) return;
    const awards = await res.json();
    list.innerHTML = "";
    if (!awards.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    awards.forEach((a) => {
      const row = document.createElement("div");
      row.className = "squad-item";
      row.innerHTML = `
        <span class="player-name">${AWARD_LABELS[a.award_type] || a.award_type} — ${a.player_name}</span>
        <span class="muted" style="font-size:13px; white-space:nowrap;">${a.period_date}</span>
      `;
      list.appendChild(row);
    });
  } catch (err) {
    console.error("Failed to load recent awards:", err);
  }
}

// ---------------------------------------------------------------
// Clock (minutes only — good enough for a match report). totalPausedMs
// accumulates every half-time/stoppage break so the clock and event
// minutes correctly exclude paused time rather than just running
// straight off wall-clock time since kickoff.
// ---------------------------------------------------------------
function startClock() {
  clockInterval = setInterval(() => {
    const elapsedMs = Date.now() - match.startedAt - match.totalPausedMs;
    const mins = Math.floor(elapsedMs / 60000);
    const secs = Math.floor((elapsedMs % 60000) / 1000);
    document.getElementById("match-clock").textContent =
      `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, 1000);
}

function currentMinute() {
  return Math.max(1, Math.floor((Date.now() - match.startedAt - match.totalPausedMs) / 60000));
}

// ---------------------------------------------------------------
// Half-time / stoppage pause — toggles the clock and disables the
// scoring buttons so a stray pitch-side tap during the break can't
// record a phantom event. Re-usable for any stoppage, not just the
// official half-time break (injuries etc. are common in kids football).
// ---------------------------------------------------------------
function togglePause() {
  const pauseBtn = document.getElementById("btn-pause");
  const scoringBtns = [
    document.getElementById("btn-goal-us"),
    document.getElementById("btn-save"),
    document.getElementById("btn-goal-them"),
  ];

  if (match.pausedAt) {
    // resuming
    match.totalPausedMs += Date.now() - match.pausedAt;
    match.pausedAt = null;
    startClock();
    pauseBtn.textContent = "⏸ Half Time";
    scoringBtns.forEach((b) => (b.disabled = false));
  } else {
    // pausing
    match.pausedAt = Date.now();
    clearInterval(clockInterval);
    document.getElementById("match-clock").textContent = "HALF TIME";
    pauseBtn.textContent = "▶ Start 2nd Half";
    scoringBtns.forEach((b) => (b.disabled = true));
  }
}

// ---------------------------------------------------------------
// Score + log rendering
// ---------------------------------------------------------------
function renderScore() {
  document.getElementById("score-us").textContent = match.our_score;
  document.getElementById("score-them").textContent = match.their_score;
}

function renderLog() {
  const log = document.getElementById("event-log");
  log.innerHTML = "";
  if (!match.events.length) {
    log.innerHTML = `<p class="log-empty">No events yet — tap a button above to record the first one.</p>`;
    return;
  }
  [...match.events].reverse().forEach((e) => {
    const row = document.createElement("div");
    row.className = "log-entry";
    row.innerHTML = `
      <span class="minute">${e.minute}'</span>
      <span>${describeEvent(e)}</span>
      <button class="undo" data-id="${e.id}">undo</button>
    `;
    log.appendChild(row);
  });
  log.querySelectorAll(".undo").forEach((btn) => {
    btn.addEventListener("click", () => undoEvent(btn.dataset.id));
  });
}

function describeEvent(e) {
  if (e.type === "goal") {
    const scorer = e.player || "Unknown scorer";
    const base = e.assist ? `Goal — ${scorer} (assist: ${e.assist})` : `Goal — ${scorer}`;
    // Open play is the common case — only call it out when it's not.
    return e.goal_type && e.goal_type !== "open_play"
      ? `${base} [${GOAL_TYPE_LABELS[e.goal_type]}]`
      : base;
  }
  if (e.type === "goal_them") return "Goal conceded";
  if (e.type === "save") return `Save — ${e.player || "Unknown keeper"}`;
  return e.type;
}

function undoEvent(id) {
  const idx = match.events.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const [removed] = match.events.splice(idx, 1);
  if (removed.type === "goal") match.our_score = Math.max(0, match.our_score - 1);
  if (removed.type === "goal_them") match.their_score = Math.max(0, match.their_score - 1);
  renderScore();
  renderLog();
}

// ---------------------------------------------------------------
// Player picker sheet — pulls from the saved squad, shows shirt numbers
// ---------------------------------------------------------------
function openPicker(title, onPick) {
  pendingAction = onPick;
  document.getElementById("picker-title").textContent = title;
  const list = document.getElementById("picker-list");
  list.innerHTML = "";
  squad
    .slice()
    .sort((a, b) => (a.number ?? 99) - (b.number ?? 99))
    .forEach((p) => {
      const btn = document.createElement("button");
      btn.className = "player-option";
      btn.innerHTML = `<span class="number-badge">${p.number ?? "-"}</span><span>${p.name}</span>`;
      btn.addEventListener("click", () => {
        closePicker();
        onPick(p.name);
      });
      list.appendChild(btn);
    });
  document.getElementById("picker-backdrop").classList.remove("hidden");
}

function closePicker() {
  document.getElementById("picker-backdrop").classList.add("hidden");
}

// ---------------------------------------------------------------
// Goal-type picker — same sheet as the player picker, fixed options
// instead of the squad list. Skip/Unknown falls back to open_play
// (the common case) via the existing picker-skip handler below, which
// calls pendingAction(null).
// ---------------------------------------------------------------
const GOAL_TYPE_LABELS = { open_play: "Open Play", free_kick: "Free Kick", penalty: "Penalty" };

function openGoalTypePicker(onPick) {
  pendingAction = onPick;
  document.getElementById("picker-title").textContent = "How was it scored?";
  const list = document.getElementById("picker-list");
  list.innerHTML = "";
  Object.entries(GOAL_TYPE_LABELS).forEach(([value, label]) => {
    const btn = document.createElement("button");
    btn.className = "player-option";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      closePicker();
      onPick(value);
    });
    list.appendChild(btn);
  });
  document.getElementById("picker-backdrop").classList.remove("hidden");
}

// ---------------------------------------------------------------
// App init — wired up once, after a session is confirmed. Everything
// here was previously top-level code that ran unconditionally on load;
// gating it behind login means none of it touches the DOM until the
// coach has signed in.
// ---------------------------------------------------------------
function initApp() {
  document.getElementById("add-player-btn").addEventListener("click", () => {
    const nameInput = document.getElementById("new-player-name");
    const numberInput = document.getElementById("new-player-number");
    const name = nameInput.value.trim();
    if (!name) return;
    squad.push({
      id: crypto.randomUUID(),
      name,
      number: numberInput.value ? parseInt(numberInput.value, 10) : null,
    });
    nameInput.value = "";
    numberInput.value = "";
    nameInput.focus();
    saveSquad();
  });

  document.getElementById("manage-squad-btn").addEventListener("click", () => {
    document.getElementById("setup").classList.add("hidden");
    document.getElementById("squad-screen").classList.remove("hidden");
  });

  document.getElementById("squad-back-btn").addEventListener("click", () => {
    document.getElementById("squad-screen").classList.add("hidden");
    document.getElementById("setup").classList.remove("hidden");
  });

  document.getElementById("award-type").addEventListener("change", updateAwardPeriodInputs);

  document.getElementById("award-player-btn").addEventListener("click", () => {
    openPicker("Who won this award?", (name) => {
      if (!name) return;
      selectedAwardPlayer = name;
      document.getElementById("award-player-btn").textContent = `${name} →`;
    });
  });

  document.getElementById("manage-awards-btn").addEventListener("click", () => {
    document.getElementById("setup").classList.add("hidden");
    document.getElementById("awards-screen").classList.remove("hidden");
    updateAwardPeriodInputs();
    resetAwardForm();
    renderAwardsList();
  });

  document.getElementById("awards-back-btn").addEventListener("click", () => {
    document.getElementById("awards-screen").classList.add("hidden");
    document.getElementById("setup").classList.remove("hidden");
  });

  document.getElementById("save-award-btn").addEventListener("click", async () => {
    const errorEl = document.getElementById("award-error");
    errorEl.classList.add("hidden");
    const awardType = document.getElementById("award-type").value;
    const isMonthly = awardType === "player_of_month";
    const monthValue = document.getElementById("award-period-month").value;
    const periodDate = isMonthly
      ? (monthValue ? `${monthValue}-01` : "")
      : document.getElementById("award-period-date").value;

    if (!selectedAwardPlayer) {
      errorEl.textContent = "Select a player first.";
      errorEl.classList.remove("hidden");
      return;
    }
    if (!periodDate) {
      errorEl.textContent = isMonthly ? "Select a month." : "Select a date.";
      errorEl.classList.remove("hidden");
      return;
    }

    const btn = document.getElementById("save-award-btn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    await saveAward({ award_type: awardType, player_name: selectedAwardPlayer, period_date: periodDate });
    btn.disabled = false;
    btn.textContent = "Save Award";
    resetAwardForm();
    renderAwardsList();
  });

  renderSquadList();
  updateSquadCountBadge();

  document.getElementById("match-date").valueAsDate = new Date();

  document.getElementById("start-match-btn").addEventListener("click", () => {
    if (!squad.length) {
      alert("Add at least one player to the squad first (tap Manage Squad).");
      return;
    }

    const opposition = document.getElementById("opposition").value.trim() || "Opposition";
    const matchDate = document.getElementById("match-date").value;
    const venue = document.getElementById("venue").value;
    const competition = document.getElementById("competition").value.trim();

    match = {
      id: crypto.randomUUID(),
      opposition,
      match_date: matchDate,
      venue,
      competition,
      our_score: 0,
      their_score: 0,
      status: "in_progress",
      events: [],       // { id, type, player, number, assist, minute }
      startedAt: Date.now(),
      totalPausedMs: 0, // accumulated half-time/stoppage duration, excluded from the clock
      pausedAt: null,   // timestamp the current pause began, or null if running
    };

    document.getElementById("setup").classList.add("hidden");
    document.getElementById("match-screen").classList.remove("hidden");
    document.getElementById("fixture-label").textContent =
      venue === "home"
        ? `${CONFIG.TEAM_NAME} vs ${match.opposition}`
        : `${match.opposition} vs ${CONFIG.TEAM_NAME}`;

    // Defensive reset in case a previous match ended mid-pause — the
    // pause state itself is on the new match object either way, but
    // the button text/disabled state is DOM state that would otherwise
    // carry over from whatever it was left showing.
    document.getElementById("btn-pause").textContent = "⏸ Half Time";
    [
      document.getElementById("btn-goal-us"),
      document.getElementById("btn-save"),
      document.getElementById("btn-goal-them"),
    ].forEach((b) => (b.disabled = false));

    startClock();
    renderScore();
    renderLog();
  });

  document.getElementById("btn-pause").addEventListener("click", togglePause);

  document.getElementById("btn-goal-us").addEventListener("click", () => {
    match.our_score += 1;
    renderScore();
    openPicker("Who scored?", (scorer) => {
      const event = {
        id: crypto.randomUUID(),
        type: "goal",
        player: scorer,
        assist: null,
        goal_type: "open_play",
        minute: currentMinute(),
      };
      match.events.push(event);
      renderLog();
      if (scorer) {
        openGoalTypePicker((goalType) => {
          event.goal_type = goalType || "open_play";
          renderLog();
          // Penalties are essentially never credited with an assist, so
          // skip that prompt for them and keep live recording quick.
          if (event.goal_type !== "penalty") {
            openPicker("Assist? (optional)", (assister) => {
              event.assist = assister || null;
              renderLog();
            });
          }
        });
      }
    });
  });

  document.getElementById("btn-save").addEventListener("click", () => {
    // Single dedicated keeper (squad #1, Reon) — skip the picker prompt
    // and log the save straight to them. Update GOALKEEPER_NAME near
    // CONFIG if this ever changes.
    match.events.push({ id: crypto.randomUUID(), type: "save", player: GOALKEEPER_NAME, minute: currentMinute() });
    renderLog();
  });

  document.getElementById("btn-goal-them").addEventListener("click", () => {
    match.their_score += 1;
    match.events.push({ id: crypto.randomUUID(), type: "goal_them", player: null, minute: currentMinute() });
    renderScore();
    renderLog();
  });

  document.getElementById("btn-end-match").addEventListener("click", async () => {
    if (!confirm("End the match? This locks in the final score.")) return;
    clearInterval(clockInterval);
    match.status = "completed";

    const archive = store.get("matches_archive", []);
    archive.push(match);
    store.set("matches_archive", archive);

    // Must await both of these before reloading — otherwise the reload
    // can tear down the page mid-request. Report generation is
    // best-effort only: if it fails (Ollama Cloud down, quota, offline),
    // the match itself is already safely synced by the time this runs.
    const savedMatch = await syncMatch(match);
    if (savedMatch) await generateAndSaveReport(savedMatch.id, match);

    alert(`Final score saved: ${CONFIG.TEAM_NAME} ${match.our_score} – ${match.their_score} ${match.opposition}`);
    window.location.reload();
  });

  document.getElementById("picker-skip").addEventListener("click", () => {
    closePicker();
    if (pendingAction) pendingAction(null);
  });
}

// ---------------------------------------------------------------
// Login / logout — these listeners are always wired (the login
// screen's own elements exist regardless of auth state); initApp()
// itself only runs once a session is confirmed.
// ---------------------------------------------------------------
function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("setup").classList.add("hidden");
}

function showApp() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("setup").classList.remove("hidden");
  document.getElementById("logout-btn").classList.remove("hidden");
}

document.getElementById("login-btn").addEventListener("click", async () => {
  const errorEl = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  btn.disabled = true;
  btn.textContent = "Signing In…";
  try {
    const session = await signIn(email, password);
    errorEl.classList.add("hidden");
    showApp();
    initApp();
    syncSquadFromSupabase(session);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign In";
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  clearSession();
  window.location.reload();
});

// Boot: already-signed-in devices skip straight to the app (and get a
// fire-and-forget token refresh + squad sync); everyone else sees the
// login screen.
if (getSession()) {
  showApp();
  initApp();
  ensureFreshSession().then((session) => {
    if (session) syncSquadFromSupabase(session);
  });
} else {
  showLogin();
}

// ---------------------------------------------------------------
// Resolve a squad member's name to their Supabase `players` row id,
// creating the row on first sync if it doesn't exist yet. Cached
// locally (name -> id) so repeat matches don't re-look-up every time.
// ---------------------------------------------------------------
async function resolvePlayerId(headers, name) {
  if (!name) return null;

  const cache = store.get("player_ids", {});
  if (cache[name]) return cache[name];

  const lookupRes = await fetch(
    `${CONFIG.SUPABASE_URL}/rest/v1/players?name=eq.${encodeURIComponent(name)}&select=id&limit=1`,
    { headers }
  );
  const existing = await lookupRes.json();
  if (existing.length) {
    cache[name] = existing[0].id;
    store.set("player_ids", cache);
    return existing[0].id;
  }

  const squadEntry = squad.find((p) => p.name === name);
  const createRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/players`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ name, squad_number: squadEntry?.number ?? null }),
  });
  const [created] = await createRes.json();
  cache[name] = created.id;
  store.set("player_ids", cache);
  return created.id;
}

// ---------------------------------------------------------------
// Sync to Supabase (best-effort; falls back to local queue)
// ---------------------------------------------------------------
async function syncMatch(m) {
  const statusEl = document.getElementById("sync-status");
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    if (statusEl) statusEl.textContent = "Saved on this device — add Supabase keys in app.js to enable sync";
    queueForSync(m);
    return;
  }

  const session = await ensureFreshSession();
  if (!session) {
    if (statusEl) statusEl.textContent = "Not signed in — saved on this device, will retry once signed in";
    queueForSync(m);
    return;
  }

  try {
    const headers = {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    };

    const matchRes = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/matches`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        opposition: m.opposition,
        match_date: m.match_date,
        venue: m.venue,
        competition: m.competition,
        our_score: m.our_score,
        their_score: m.their_score,
        status: "completed",
      }),
    });
    const [savedMatch] = await matchRes.json();

    const eventRows = [];
    for (const e of m.events) {
      eventRows.push({
        match_id: savedMatch.id,
        player_id: await resolvePlayerId(headers, e.player),
        event_type: e.type === "goal_them" ? "own_goal" : e.type,
        minute: e.minute,
        goal_type: e.type === "goal" ? e.goal_type || "open_play" : null,
      });
      if (e.assist) {
        eventRows.push({
          match_id: savedMatch.id,
          player_id: await resolvePlayerId(headers, e.assist),
          event_type: "assist",
          minute: e.minute,
        });
      }
    }

    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(eventRows),
    });

    if (statusEl) statusEl.textContent = "Synced to dashboard ✓";
    return savedMatch;
  } catch (err) {
    console.error("Sync failed, queued for retry:", err);
    queueForSync(m);
    if (statusEl) statusEl.textContent = "Offline — queued, will retry when back online";
  }
}

function queueForSync(m) {
  const queue = store.get("sync_queue", []);
  queue.push(m);
  store.set("sync_queue", queue);
}

// ---------------------------------------------------------------
// Match report generation — after a match syncs, ask the report
// service (self-host/report-service, backed by an Ollama Cloud model)
// to draft a short match report, then save it via the same
// authenticated PostgREST pattern already used for events/awards.
// Best-effort only: a failure here (Ollama Cloud down, over quota,
// offline) never re-queues or blocks anything — the match and its
// events are already safely synced by the time this runs, so at worst
// a match is just missing its generated report.
// ---------------------------------------------------------------
async function generateAndSaveReport(matchId, m) {
  const session = await ensureFreshSession();
  if (!session) return;

  const events = m.events.map((e) => ({
    event_type: e.type === "goal_them" ? "own_goal" : e.type,
    minute: e.minute,
    player_name: e.player || null,
    goal_type: e.type === "goal" ? e.goal_type || "open_play" : null,
  }));

  let reportText;
  try {
    const genRes = await fetch(`${CONFIG.SUPABASE_URL}/report/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({
        opposition: m.opposition,
        venue: m.venue,
        competition: m.competition,
        our_score: m.our_score,
        their_score: m.their_score,
        events,
      }),
    });
    const data = await genRes.json().catch(() => ({}));
    if (!genRes.ok) throw new Error(data.error || `HTTP ${genRes.status}`);
    reportText = data.report;
  } catch (err) {
    console.error("Report generation failed (match is still saved):", err);
    return;
  }
  if (!reportText) return;

  try {
    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/reports`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ match_id: matchId, report_text: reportText }),
    });
  } catch (err) {
    console.error("Saving generated report failed:", err);
  }
}

// ---------------------------------------------------------------
// Sync an award (best-effort; falls back to local queue) — same
// pattern as syncMatch/queueForSync above, separate queue since an
// award is a different shape of record.
// ---------------------------------------------------------------
async function saveAward(award) {
  const session = await ensureFreshSession();
  if (!session) {
    queueAwardForSync(award);
    alert("Not signed in — award saved on this device, will sync once signed in.");
    return;
  }
  const headers = {
    "Content-Type": "application/json",
    apikey: CONFIG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
  };
  let res;
  try {
    const playerId = await resolvePlayerId(headers, award.player_name);
    res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/awards`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        award_type: award.award_type,
        player_id: playerId,
        period_date: award.period_date,
      }),
    });
  } catch (err) {
    // Genuine network failure (offline, DNS, etc.) — safe to queue and
    // retry later, since the request never actually reached the server.
    console.error("Award sync failed (network), queued for retry:", err);
    queueAwardForSync(award);
    alert("Offline — award saved on this device, will sync once back online.");
    return;
  }
  if (!res.ok) {
    // fetch() only rejects on network failure, NOT on HTTP error status
    // — a 400/403/404/etc. here means the request reached the server
    // and was rejected (bad data, missing table, RLS, ...). Retrying
    // automatically won't fix that, so surface the real reason instead
    // of silently pretending it saved.
    const body = await res.json().catch(() => ({}));
    const message = body.message || body.hint || `Server rejected the award (HTTP ${res.status})`;
    console.error("Award save rejected by server:", res.status, body);
    alert(`Award NOT saved — ${message}`);
  }
}

function queueAwardForSync(award) {
  const queue = store.get("award_sync_queue", []);
  queue.push(award);
  store.set("award_sync_queue", queue);
}

// Retry queued matches and awards whenever we come back online
window.addEventListener("online", async () => {
  const queue = store.get("sync_queue", []);
  if (queue.length) {
    store.set("sync_queue", []);
    for (const m of queue) await syncMatch(m);
  }
  const awardQueue = store.get("award_sync_queue", []);
  if (awardQueue.length) {
    store.set("award_sync_queue", []);
    for (const a of awardQueue) await saveAward(a);
  }
});

// ---------------------------------------------------------------
// Register service worker for offline app-shell caching
// ---------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed:", err));
  });
}
