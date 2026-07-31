// Fill these in — same project as recorder/app.js
const CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
};

async function loadDashboard() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    document.getElementById("config-notice").classList.remove("hidden");
    document.getElementById("stats-empty").classList.remove("hidden");
    document.getElementById("results-empty").classList.remove("hidden");
    return;
  }

  const headers = {
    apikey: CONFIG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
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

loadDashboard();
