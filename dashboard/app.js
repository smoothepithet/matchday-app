// Same project as recorder/app.js — keep these two in sync.

// Dev-mode URL switch (see app.js for the full comment) — visiting
// ?dev=1&key=<dev anon key> once sets the localStorage override for
// mobile testing without DevTools; ?dev=0 clears it.
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

// Falls back to a dev backend when set via the URL switch above or the
// browser console — see the comment in app.js for the localStorage keys.
const CONFIG = {
  SUPABASE_URL: localStorage.getItem("dev_supabase_url") || "https://matchday-api.shadowlan.org",
  SUPABASE_ANON_KEY: localStorage.getItem("dev_supabase_anon_key") || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6Im1hdGNoZGF5LXNlbGYtaG9zdCIsImlhdCI6MTc4OTExOTc2MSwiZXhwIjoyMTA0Njk1NzYxfQ.L9_Tlu6kLFrjv-EUFrGTl6i2yUNCWopLyX0gkSJS9S8",  // your anon/public key
};

// Dev-mode indicator — same as app.js, no new accent colour.
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
// Storage helpers (same pattern as recorder/app.js)
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
// Auth (Supabase email/password, single shared coach account) —
// duplicated verbatim from recorder/app.js, keep the two in sync
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

function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("dashboard-content").classList.add("hidden");
}

function showDashboard() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("dashboard-content").classList.remove("hidden");
  document.getElementById("logout-btn").classList.remove("hidden");
}

document.getElementById("login-btn").addEventListener("click", async () => {
  const errorEl = document.getElementById("login-error");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await signIn(email, password);
    errorEl.classList.add("hidden");
    showDashboard();
    loadDashboard();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove("hidden");
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  clearSession();
  window.location.reload();
});

document.getElementById("filter-venue").addEventListener("change", applyResultsFilters);
document.getElementById("filter-result").addEventListener("change", applyResultsFilters);
document.getElementById("filter-competition").addEventListener("change", applyResultsFilters);
document.getElementById("filter-award-type").addEventListener("change", applyAwardsFilters);

// ---------------------------------------------------------------
// Tabs — Overview (stats/results/awards) vs. Match Reports, its own
// tab since a season's worth of full report text is long to scroll
// past just to check a result.
// ---------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(name) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `tab-${name}`);
  });
}

// Jump from a Results row's score straight to that match's report —
// switches tab, scrolls it into view, and briefly highlights it so
// it's obvious which card the click landed on.
function showReport(matchId) {
  switchTab("reports");
  const card = document.getElementById(`report-${matchId}`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("highlight");
  setTimeout(() => card.classList.remove("highlight"), 1500);
}

// ---------------------------------------------------------------
// Dashboard data loading
// ---------------------------------------------------------------
async function loadDashboard() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    document.getElementById("config-notice").classList.remove("hidden");
    document.getElementById("stats-empty").classList.remove("hidden");
    document.getElementById("results-empty").classList.remove("hidden");
    document.getElementById("awards-empty").classList.remove("hidden");
    document.getElementById("reports-empty").classList.remove("hidden");
    document.getElementById("goals-chart-empty").classList.remove("hidden");
    return;
  }

  const session = await ensureFreshSession();
  if (!session) {
    showLogin();
    return;
  }

  const headers = {
    apikey: CONFIG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
  };

  try {
    const [statsRes, resultsRes, awardsRes, reportsRes] = await Promise.all([
      fetch(`${CONFIG.SUPABASE_URL}/rest/v1/player_season_stats`, { headers }),
      fetch(`${CONFIG.SUPABASE_URL}/rest/v1/results_log`, { headers }),
      fetch(`${CONFIG.SUPABASE_URL}/rest/v1/season_awards`, { headers }),
      fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/reports?select=id,match_id,report_text,created_at,matches(match_date,opposition,our_score,their_score)&order=created_at.desc`,
        { headers }
      ),
    ]);
    const stats = await statsRes.json();
    allResults = await resultsRes.json();
    allAwards = await awardsRes.json();
    const reports = await reportsRes.json();
    reportMatchIds = new Set((Array.isArray(reports) ? reports : []).map((r) => r.match_id));
    renderStats(stats);
    renderCleanSheets(allResults);
    renderRecord(allResults);
    renderGoalsChart(allResults);
    applyResultsFilters();
    applyAwardsFilters();
    renderReports(Array.isArray(reports) ? reports : []);
  } catch (err) {
    console.error("Dashboard load failed:", err);
  }
}

// Season total, deliberately not affected by the Results filters below —
// same "whole-season headline stat" treatment as Player Stats.
function renderCleanSheets(results) {
  const count = results.filter((r) => r.their_score === 0).length;
  document.getElementById("clean-sheets-value").textContent = count;
}

// Season record (W/D/L) — same whole-season, filter-independent
// treatment as Clean sheets. Reuses the .result-badge letter styling
// already established in the Results table rather than introducing a
// new color per outcome.
function renderRecord(results) {
  const counts = { W: 0, D: 0, L: 0 };
  results.forEach((r) => {
    if (counts[r.result] !== undefined) counts[r.result]++;
  });
  document.getElementById("record-w").textContent = counts.W;
  document.getElementById("record-d").textContent = counts.D;
  document.getElementById("record-l").textContent = counts.L;
}

// Goals-per-match bar chart — hand-rolled SVG (no charting library, in
// keeping with the rest of the app having no build step/dependencies).
// Whole-season, chronological left-to-right, filter-independent like
// Clean sheets/Record above.
function renderGoalsChart(results) {
  const svg = document.getElementById("goals-chart");
  const empty = document.getElementById("goals-chart-empty");
  svg.innerHTML = "";

  // results_log comes back newest-first; reverse for a left-to-right timeline.
  const chronological = [...results].reverse();
  if (!chronological.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const width = 600;
  const height = 200;
  const marginTop = 10;
  const marginRight = 10;
  const marginBottom = 24;
  const marginLeft = 26;
  const innerWidth = width - marginLeft - marginRight;
  const innerHeight = height - marginTop - marginBottom;

  const maxGoals = Math.max(1, ...chronological.map((r) => r.our_score));
  const step = maxGoals <= 5 ? 1 : Math.ceil(maxGoals / 5);
  const axisMax = Math.ceil(maxGoals / step) * step;

  const n = chronological.length;
  const gap = 4;
  const barWidth = Math.max(2, Math.min(20, (innerWidth - gap * (n - 1)) / n));
  const actualGap = n > 1 ? (innerWidth - barWidth * n) / (n - 1) : 0;

  const svgNS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs) => {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };

  // Gridlines + y-axis labels, 0 up to axisMax in `step` increments.
  for (let v = 0; v <= axisMax; v += step) {
    const y = marginTop + innerHeight - (v / axisMax) * innerHeight;
    svg.appendChild(el("line", { x1: marginLeft, x2: width - marginRight, y1: y, y2: y, class: "chart-gridline" }));
    const label = el("text", { x: marginLeft - 6, y: y + 3, class: "chart-axis-text", "text-anchor": "end" });
    label.textContent = v;
    svg.appendChild(label);
  }

  // At most ~8 x-axis date labels, evenly spaced, so they never overlap
  // regardless of how many matches are in the season.
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  chronological.forEach((r, i) => {
    const x = marginLeft + i * (barWidth + actualGap);
    const barHeight = Math.max(0, (r.our_score / axisMax) * innerHeight);
    const y = marginTop + innerHeight - barHeight;
    const rect = el("rect", { x, y, width: barWidth, height: barHeight, rx: 2, class: "chart-bar" });
    const title = document.createElementNS(svgNS, "title");
    title.textContent = `${r.match_date} vs ${r.opposition}: ${r.our_score} scored`;
    rect.appendChild(title);
    svg.appendChild(rect);

    if (i % labelEvery === 0) {
      const label = el("text", {
        x: x + barWidth / 2,
        y: height - marginBottom + 14,
        class: "chart-axis-text",
        "text-anchor": "middle",
      });
      label.textContent = (r.match_date || "").slice(5).replace("-", "/");
      svg.appendChild(label);
    }
  });
}

const AWARD_LABELS = {
  training_potw: "Training POTW",
  managers_potw: "Manager's POTW",
  parents_potw: "Parents' POTW",
  player_of_month: "Player of the Month",
};

// ---------------------------------------------------------------
// Filters — client-side, over the full already-fetched data (a
// season's worth of matches/awards is tiny, no point re-querying the
// server for this). "No data at all" and "no data matches the
// selected filter" are deliberately different empty states, so a
// filtered-to-nothing view doesn't look like the season has no data.
// ---------------------------------------------------------------
let allResults = [];
let allAwards = [];
let reportMatchIds = new Set();

function applyResultsFilters() {
  const venue = document.getElementById("filter-venue").value;
  const result = document.getElementById("filter-result").value;
  const competition = document.getElementById("filter-competition").value;
  const filtered = allResults.filter(
    (r) =>
      (!venue || r.venue === venue) &&
      (!result || r.result === result) &&
      (!competition || r.competition === competition)
  );
  renderResults(filtered, allResults.length > 0);
}

function applyAwardsFilters() {
  const type = document.getElementById("filter-award-type").value;
  const filtered = allAwards.filter((a) => !type || a.award_type === type);
  renderAwards(filtered, allAwards.length > 0);
}

function renderAwards(rows, hasAnyData) {
  const body = document.getElementById("awards-body");
  const empty = document.getElementById("awards-empty");
  const filteredEmpty = document.getElementById("awards-filtered-empty");
  body.innerHTML = "";
  empty.classList.add("hidden");
  filteredEmpty.classList.add("hidden");
  if (!rows.length) {
    (hasAnyData ? filteredEmpty : empty).classList.remove("hidden");
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.period_date}</td>
      <td><span class="award-pill">${AWARD_LABELS[r.award_type] || r.award_type}</span></td>
      <td><span class="number-badge">${r.squad_number ?? "-"}</span>${r.player_name}</td>
    `;
    body.appendChild(tr);
  });
}

// Match reports — auto-generated (see self-host/report-service) right
// after each match syncs. Read-only here; no filters, a season's worth
// is small enough to just scroll.
function renderReports(rows) {
  const list = document.getElementById("reports-list");
  const empty = document.getElementById("reports-empty");
  list.innerHTML = "";
  if (!rows.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  rows.forEach((r) => {
    const m = r.matches || {};
    const card = document.createElement("div");
    card.className = "report-card";
    card.id = `report-${r.match_id}`;
    card.innerHTML = `
      <div class="report-card-header">
        <div class="report-card-meta">${m.match_date ?? ""} — ${m.opposition ?? "Match"} (${m.our_score ?? "?"}–${m.their_score ?? "?"})</div>
        <button type="button" class="copy-btn">Copy</button>
      </div>
      <p class="report-card-text"></p>
    `;
    card.querySelector(".report-card-text").textContent = r.report_text;

    const copyBtn = card.querySelector(".copy-btn");
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(r.report_text);
      } catch {
        // Clipboard API needs a secure context/permission — fall back to
        // the old select-and-copy trick rather than leaving the button
        // silently do nothing (e.g. non-HTTPS local testing).
        const textarea = document.createElement("textarea");
        textarea.value = r.report_text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      const original = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      copyBtn.disabled = true;
      setTimeout(() => {
        copyBtn.textContent = original;
        copyBtn.disabled = false;
      }, 1500);
    });

    list.appendChild(card);
  });
}

function renderStats(rows) {
  const body = document.getElementById("stats-body");
  const empty = document.getElementById("stats-empty");
  body.innerHTML = "";
  if (!rows.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="number-badge">${r.squad_number ?? "-"}</span>${r.name}</td>
      <td class="num">${r.appearances}</td>
      <td class="num">${r.goals}</td>
      <td class="num">${r.assists}</td>
      <td class="num">${r.saves}</td>
    `;
    body.appendChild(tr);
  });
}

function renderResults(rows, hasAnyData) {
  const body = document.getElementById("results-body");
  const empty = document.getElementById("results-empty");
  const filteredEmpty = document.getElementById("results-filtered-empty");
  body.innerHTML = "";
  empty.classList.add("hidden");
  filteredEmpty.classList.add("hidden");
  if (!rows.length) {
    (hasAnyData ? filteredEmpty : empty).classList.remove("hidden");
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    const score = `${r.our_score}–${r.their_score}`;
    const scoreCell = reportMatchIds.has(r.id)
      ? `<button type="button" class="score-link" data-match-id="${r.id}">${score}</button>`
      : score;
    tr.innerHTML = `
      <td>${r.match_date}</td>
      <td>${r.opposition}</td>
      <td>${r.venue}</td>
      <td>${r.competition || "—"}</td>
      <td class="num">${scoreCell}</td>
      <td class="num"><span class="result-badge result-${r.result}">${r.result}</span></td>
    `;
    body.appendChild(tr);
  });
  body.querySelectorAll(".score-link").forEach((btn) => {
    btn.addEventListener("click", () => showReport(btn.dataset.matchId));
  });
}

// Boot: already-signed-in devices skip straight to the dashboard;
// everyone else sees the login screen.
if (getSession()) {
  showDashboard();
  loadDashboard();
} else {
  showLogin();
}
