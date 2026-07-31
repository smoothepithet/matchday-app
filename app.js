// ---------------------------------------------------------------
// CONFIG — fill these in once you've created your Supabase project
// and run supabase/schema.sql. Until then, the app still works
// fully offline and just queues events locally.
// ---------------------------------------------------------------
const CONFIG = {
  TEAM_NAME: "Wyrley Rockets",
  SUPABASE_URL: "https://mdflfblggeimrhsltmju.supabase.co/",       
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kZmxmYmxnZ2VpbXJoc2x0bWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MDUwNTcsImV4cCI6MjEwMTA4MTA1N30.K0JUwlelNKjsiIMx_-u8uuc1ocuohJO-xyGvbGgU6tA",  // your anon/public key
};

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
// Squad (player profiles) — persists across matches on this device
// ---------------------------------------------------------------
let squad = store.get("squad", []); // [{ id, name, number }]

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

renderSquadList();
updateSquadCountBadge();

// ---------------------------------------------------------------
// App state
// ---------------------------------------------------------------
let match = null;       // current match object while live
let clockInterval = null;
let pendingAction = null; // resolves the currently-open player picker

// ---------------------------------------------------------------
// Setup screen
// ---------------------------------------------------------------
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
  };

  document.getElementById("setup").classList.add("hidden");
  document.getElementById("match-screen").classList.remove("hidden");
  document.getElementById("fixture-label").textContent =
    venue === "home"
      ? `${CONFIG.TEAM_NAME} vs ${match.opposition}`
      : `${match.opposition} vs ${CONFIG.TEAM_NAME}`;

  startClock();
  renderScore();
  renderLog();
});

// ---------------------------------------------------------------
// Clock (minutes only — good enough for a match report)
// ---------------------------------------------------------------
function startClock() {
  clockInterval = setInterval(() => {
    const elapsedMs = Date.now() - match.startedAt;
    const mins = Math.floor(elapsedMs / 60000);
    const secs = Math.floor((elapsedMs % 60000) / 1000);
    document.getElementById("match-clock").textContent =
      `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, 1000);
}

function currentMinute() {
  return Math.max(1, Math.floor((Date.now() - match.startedAt) / 60000));
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
    return e.assist ? `Goal — ${scorer} (assist: ${e.assist})` : `Goal — ${scorer}`;
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
// Action buttons
// ---------------------------------------------------------------
document.getElementById("btn-goal-us").addEventListener("click", () => {
  match.our_score += 1;
  renderScore();
  openPicker("Who scored?", (scorer) => {
    const event = { id: crypto.randomUUID(), type: "goal", player: scorer, assist: null, minute: currentMinute() };
    match.events.push(event);
    renderLog();
    if (scorer) {
      openPicker("Assist? (optional)", (assister) => {
        event.assist = assister || null;
        renderLog();
      });
    }
  });
});

document.getElementById("btn-save").addEventListener("click", () => {
  openPicker("Who made the save?", (keeper) => {
    match.events.push({ id: crypto.randomUUID(), type: "save", player: keeper, minute: currentMinute() });
    renderLog();
  });
});

document.getElementById("btn-goal-them").addEventListener("click", () => {
  match.their_score += 1;
  match.events.push({ id: crypto.randomUUID(), type: "goal_them", player: null, minute: currentMinute() });
  renderScore();
  renderLog();
});

document.getElementById("btn-end-match").addEventListener("click", () => {
  if (!confirm("End the match? This locks in the final score.")) return;
  clearInterval(clockInterval);
  match.status = "completed";

  const archive = store.get("matches_archive", []);
  archive.push(match);
  store.set("matches_archive", archive);

  syncMatch(match);

  alert(`Final score saved: ${CONFIG.TEAM_NAME} ${match.our_score} – ${match.their_score} ${match.opposition}`);
  window.location.reload();
});

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

document.getElementById("picker-skip").addEventListener("click", () => {
  closePicker();
  if (pendingAction) pendingAction(null);
});

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

  try {
    const headers = {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
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

    const eventRows = m.events.flatMap((e) => {
      const rows = [{
        match_id: savedMatch.id,
        event_type: e.type === "goal_them" ? "own_goal" : e.type,
        minute: e.minute,
      }];
      if (e.assist) {
        rows.push({ match_id: savedMatch.id, event_type: "assist", minute: e.minute });
      }
      return rows;
    });

    await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(eventRows),
    });

    if (statusEl) statusEl.textContent = "Synced to dashboard ✓";
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

// Retry queued matches whenever we come back online
window.addEventListener("online", async () => {
  const queue = store.get("sync_queue", []);
  if (!queue.length) return;
  store.set("sync_queue", []);
  for (const m of queue) await syncMatch(m);
});

// ---------------------------------------------------------------
// Register service worker for offline app-shell caching
// ---------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("SW registration failed:", err));
  });
}
