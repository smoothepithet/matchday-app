// Same project as recorder/app.js — keep these two in sync
const CONFIG = {
  SUPABASE_URL: "https://mdflfblggeimrhsltmju.supabase.co/",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kZmxmYmxnZ2VpbXJoc2x0bWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1MDUwNTcsImV4cCI6MjEwMTA4MTA1N30.K0JUwlelNKjsiIMx_-u8uuc1ocuohJO-xyGvbGgU6tA",
};

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

// ---------------------------------------------------------------
// Dashboard data loading
// ---------------------------------------------------------------
async function loadDashboard() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    document.getElementById("config-notice").classList.remove("hidden");
    document.getElementById("stats-empty").classList.remove("hidden");
    document.getElementById("results-empty").classList.remove("hidden");
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
    const [statsRes, resultsRes] = await Promise.all([
      fetch(`${CONFIG.SUPABASE_URL}/rest/v1/player_season_stats`, { headers }),
      fetch(`${CONFIG.SUPABASE_URL}/rest/v1/results_log`, { headers }),
    ]);
    const stats = await statsRes.json();
    const results = await resultsRes.json();
    renderStats(stats);
    renderResults(results);
  } catch (err) {
    console.error("Dashboard load failed:", err);
  }
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

function renderResults(rows) {
  const body = document.getElementById("results-body");
  const empty = document.getElementById("results-empty");
  body.innerHTML = "";
  if (!rows.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.match_date}</td>
      <td>${r.opposition}</td>
      <td>${r.venue}</td>
      <td class="num">${r.our_score}–${r.their_score}</td>
      <td class="num"><span class="result-badge result-${r.result}">${r.result}</span></td>
    `;
    body.appendChild(tr);
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
