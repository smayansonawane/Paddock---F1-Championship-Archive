const API_BASE = "https://api.jolpi.ca/ergast/f1";
const CURRENT_YEAR = new Date().getFullYear();
const FIRST_SEASON = 1950;

let state = {
  tab: "drivers",
  season: CURRENT_YEAR,
  cache: {}, // key: `${tab}-${season}` -> data
};

const seasonSelect = document.getElementById("seasonSelect");
const loadingState = document.getElementById("loadingState");
const errorState = document.getElementById("errorState");
const errorMessage = document.getElementById("errorMessage");
const contentArea = document.getElementById("contentArea");
const statusLine = document.getElementById("statusLine");
const nextRaceBanner = document.getElementById("nextRaceBanner");
const retryBtn = document.getElementById("retryBtn");

const statsModal = document.getElementById("statsModal");
const modalOverlay = document.getElementById("modalOverlay");
const modalContent = document.getElementById("modalContent");
const modalClose = document.getElementById("modalClose");

// Basic bio info captured while rendering standings tables, keyed by id,
// so opening a profile doesn't need an extra round trip for name/nationality/etc.
const driverInfoCache = {};
const constructorInfoCache = {};
// Full career-stats payloads, keyed by id, so re-opening a profile is instant.
const driverStatsCache = {};
const constructorStatsCache = {};

// Populate season dropdown, newest first
for (let y = CURRENT_YEAR; y >= FIRST_SEASON; y--) {
  const opt = document.createElement("option");
  opt.value = y;
  opt.textContent = y;
  seasonSelect.appendChild(opt);
}
seasonSelect.value = CURRENT_YEAR;

seasonSelect.addEventListener("change", () => {
  state.season = parseInt(seasonSelect.value, 10);
  loadTab();
});

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.dataset.active = "false");
    btn.dataset.active = "true";
    state.tab = btn.dataset.tab;
    loadTab();
  });
});

retryBtn.addEventListener("click", loadTab);

// Event delegation: rows are re-rendered on every tab/season change, so we
// listen on the stable contentArea container rather than individual <tr>s.
contentArea.addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-driver-id], tr[data-constructor-id], tr[data-round]");
  if (!row) return;
  if (row.dataset.driverId) openDriverModal(row.dataset.driverId);
  else if (row.dataset.constructorId) openConstructorModal(row.dataset.constructorId);
  else if (row.dataset.round) openRaceModal(row.dataset.season, row.dataset.round, row.dataset.raceName, row.dataset.cancelled === "true", row.dataset.hasResults === "true");
});
contentArea.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const row = e.target.closest("tr[data-driver-id], tr[data-constructor-id], tr[data-round]");
  if (!row) return;
  e.preventDefault();
  if (row.dataset.driverId) openDriverModal(row.dataset.driverId);
  else if (row.dataset.constructorId) openConstructorModal(row.dataset.constructorId);
  else if (row.dataset.round) openRaceModal(row.dataset.season, row.dataset.round, row.dataset.raceName, row.dataset.cancelled === "true", row.dataset.hasResults === "true");
});

function openModal() {
  statsModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  statsModal.classList.add("hidden");
  document.body.style.overflow = "";
  modalContent.innerHTML = "";
}
modalOverlay.addEventListener("click", closeModal);
modalClose.addEventListener("click", closeModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !statsModal.classList.contains("hidden")) closeModal();
});

function showLoading() {
  loadingState.classList.remove("hidden");
  errorState.classList.add("hidden");
  contentArea.classList.add("hidden");
  statusLine.classList.add("hidden");
}
function showError(msg) {
  loadingState.classList.add("hidden");
  errorState.classList.remove("hidden");
  contentArea.classList.add("hidden");
  errorMessage.textContent = msg;
}
function showContent() {
  loadingState.classList.add("hidden");
  errorState.classList.add("hidden");
  contentArea.classList.remove("hidden");
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const data = await res.json();
  return data;
}

// The results endpoint returns one row per driver per race, and silently caps
// each request's row count well below any `limit` we ask for. A season with
// more than a handful of races needs several requests to see every round, so
// we page through with `offset` until MRData.total says we've covered it all.
// Without this, later races in a season would look like they never produced
// results and get mislabeled as cancelled.
async function fetchRoundsWithResults(season) {
  const pageSize = 100;
  const rounds = new Set();
  let offset = 0;
  let total = Infinity;
  let guard = 0;
  while (offset < total && guard < 30) {
    const json = await fetchJson(`${API_BASE}/${season}/results.json?limit=${pageSize}&offset=${offset}`);
    const races = json.MRData.RaceTable.Races || [];
    races.forEach(r => rounds.add(r.round));
    total = parseInt(json.MRData.total, 10) || 0;
    offset += pageSize;
    guard++;
  }
  return rounds;
}

async function loadTab() {
  showLoading();
  nextRaceBanner.classList.add("hidden");
  const cacheKey = `${state.tab}-${state.season}`;
  try {
    let data = state.cache[cacheKey];
    if (!data) {
      if (state.tab === "drivers") {
        const json = await fetchJson(`${API_BASE}/${state.season}/driverStandings.json`);
        data = json.MRData.StandingsTable.StandingsLists[0]?.DriverStandings || [];
      } else if (state.tab === "constructors") {
        const json = await fetchJson(`${API_BASE}/${state.season}/constructorStandings.json`);
        data = json.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings || [];
      } else if (state.tab === "schedule") {
        const [scheduleJson, roundsWithResults] = await Promise.all([
          fetchJson(`${API_BASE}/${state.season}.json?limit=100`),
          fetchRoundsWithResults(state.season),
        ]);
        const races = scheduleJson.MRData.RaceTable.Races || [];
        data = { races, roundsWithResults };
      }
      state.cache[cacheKey] = data;
    }

    if (state.tab === "drivers") renderDrivers(data);
    else if (state.tab === "constructors") renderConstructors(data);
    else if (state.tab === "schedule") renderSchedule(data);

    const count = state.tab === "schedule" ? data.races.length : data.length;
    statusLine.textContent = `${count} record${count === 1 ? "" : "s"} · ${state.season} season · source: jolpica-f1`;
    statusLine.classList.remove("hidden");
    showContent();
  } catch (err) {
    console.error(err);
    showError(err.message || "Something went wrong while reaching the API. Check your connection and try again.");
  }
}

function podiumClass(pos) {
  if (pos === 1) return "row-podium-1";
  if (pos === 2) return "row-podium-2";
  if (pos === 3) return "row-podium-3";
  return "";
}
function posBadge(pos) {
  let cls = "pos-badge";
  if (pos === 1) cls += " pos-1";
  else if (pos === 2) cls += " pos-2";
  else if (pos === 3) cls += " pos-3";
  return `<span class="${cls}">${pos}</span>`;
}

function emptyState(title, sub) {
  return `<div class="border border-[var(--line)] rounded-lg bg-[var(--surface)] px-6 py-16 text-center">
    <p class="font-display text-lg font-700" style="font-weight:700;">${title}</p>
    <p class="text-sm text-[var(--text-dim)] mt-2">${sub}</p>
  </div>`;
}

function renderDrivers(list) {
  if (!list.length) {
    contentArea.innerHTML = emptyState("No standings recorded", `The ${state.season} Drivers' Championship has no standings data yet.`);
    return;
  }
  const rows = list.map(d => {
    const pos = parseInt(d.position, 10);
    const name = `${d.Driver.givenName} ${d.Driver.familyName}`;
    const constructors = d.Constructors.map(c => c.name).join(" / ");
    driverInfoCache[d.Driver.driverId] = d.Driver;
    return `<tr class="clickable-row ${podiumClass(pos)}" data-driver-id="${d.Driver.driverId}" tabindex="0" role="button" aria-label="View career stats for ${name}">
      <td class="py-3 px-3 sm:px-4">${posBadge(pos)}</td>
      <td class="py-3 px-3 sm:px-4">
        <div class="font-semibold">${name}</div>
        <div class="text-xs text-[var(--text-dim)] font-mono">${d.Driver.nationality}${d.Driver.code ? " · " + d.Driver.code : ""}</div>
      </td>
      <td class="py-3 px-3 sm:px-4 text-[var(--text-dim)]">${constructors}</td>
      <td class="py-3 px-3 sm:px-4 font-mono text-right">${d.wins}</td>
      <td class="py-3 px-3 sm:px-4 font-mono font-bold text-right text-[var(--text)]">${d.points}</td>
      <td class="py-3 pr-3 sm:pr-4 pl-0 text-right"><span class="chevron text-[var(--red)]">&rsaquo;</span></td>
    </tr>`;
  }).join("");

  contentArea.innerHTML = tableWrap(`
    <thead>
      <tr class="text-left text-[11px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--line)]">
        <th class="py-3 px-3 sm:px-4 font-mono">Pos</th>
        <th class="py-3 px-3 sm:px-4 font-mono">Driver</th>
        <th class="py-3 px-3 sm:px-4 font-mono">Constructor</th>
        <th class="py-3 px-3 sm:px-4 font-mono text-right">Wins</th>
        <th class="py-3 px-3 sm:px-4 font-mono text-right">Points</th>
        <th class="py-3 pr-3 sm:pr-4 pl-0"></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  `);
}

function renderConstructors(list) {
  if (!list.length) {
    const note = state.season < 1958
      ? "The Constructors' Championship began in 1958 — earlier seasons only crowned a Drivers' Champion."
      : `No constructor standings data found for ${state.season}.`;
    contentArea.innerHTML = emptyState("No standings recorded", note);
    return;
  }
  const rows = list.map(c => {
    const pos = parseInt(c.position, 10);
    constructorInfoCache[c.Constructor.constructorId] = c.Constructor;
    return `<tr class="clickable-row ${podiumClass(pos)}" data-constructor-id="${c.Constructor.constructorId}" tabindex="0" role="button" aria-label="View stats for ${c.Constructor.name}">
      <td class="py-3 px-3 sm:px-4">${posBadge(pos)}</td>
      <td class="py-3 px-3 sm:px-4">
        <div class="font-semibold">${c.Constructor.name}</div>
        <div class="text-xs text-[var(--text-dim)] font-mono">${c.Constructor.nationality}</div>
      </td>
      <td class="py-3 px-3 sm:px-4 font-mono text-right">${c.wins}</td>
      <td class="py-3 px-3 sm:px-4 font-mono font-bold text-right text-[var(--text)]">${c.points}</td>
      <td class="py-3 pr-3 sm:pr-4 pl-0 text-right"><span class="chevron text-[var(--red)]">&rsaquo;</span></td>
    </tr>`;
  }).join("");

  contentArea.innerHTML = tableWrap(`
    <thead>
      <tr class="text-left text-[11px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--line)]">
        <th class="py-3 px-3 sm:px-4 font-mono">Pos</th>
        <th class="py-3 px-3 sm:px-4 font-mono">Constructor</th>
        <th class="py-3 px-3 sm:px-4 font-mono text-right">Wins</th>
        <th class="py-3 px-3 sm:px-4 font-mono text-right">Points</th>
        <th class="py-3 pr-3 sm:pr-4 pl-0"></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  `);
}

function renderSchedule(data) {
  const { races, roundsWithResults } = data;
  if (!races.length) {
    contentArea.innerHTML = emptyState("No calendar found", `No race schedule is available for ${state.season}.`);
    return;
  }

  const now = new Date();

  // Next race banner only meaningful for current season
  if (state.season === CURRENT_YEAR) {
    const upcoming = races.find(r => new Date(`${r.date}T${r.time || "00:00:00Z"}`) >= now);
    if (upcoming) {
      document.getElementById("nextRaceName").textContent = `${upcoming.raceName}`;
      document.getElementById("nextRaceMeta").textContent = `Round ${upcoming.round} · ${upcoming.Circuit.circuitName}, ${upcoming.Circuit.Location.country}`;
      updateCountdown(new Date(`${upcoming.date}T${upcoming.time || "00:00:00Z"}`));
      nextRaceBanner.classList.remove("hidden");
    }
  }

  const rows = races.map(r => {
    const raceDate = new Date(`${r.date}T${r.time || "00:00:00Z"}`);
    const isPast = raceDate < now;
    const hasResults = roundsWithResults.has(r.round);
    const isCancelled = isPast && !hasResults;
    const dateStr = raceDate.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

    let statusHtml;
    if (isCancelled) statusHtml = `<span class="text-[11px] uppercase tracking-wide text-[var(--red)] font-mono font-bold">Cancelled</span>`;
    else if (isPast) statusHtml = `<span class="text-[11px] uppercase tracking-wide text-[var(--text-dim)] font-mono">Completed</span>`;
    else statusHtml = `<span class="text-[11px] uppercase tracking-wide text-[var(--red)] font-mono font-bold">Upcoming</span>`;

    return `<tr class="clickable-row ${isCancelled ? "opacity-70" : isPast ? "opacity-60" : ""}" data-season="${state.season}" data-round="${r.round}" data-race-name="${r.raceName}" data-cancelled="${isCancelled}" data-has-results="${hasResults}" tabindex="0" role="button" aria-label="View results for ${r.raceName}">
      <td class="py-3 px-3 sm:px-4 font-mono text-[var(--text-dim)]">${r.round}</td>
      <td class="py-3 px-3 sm:px-4">
        <div class="font-semibold flex items-center gap-2 flex-wrap">
          <span>${r.raceName}</span>
          ${isCancelled ? `<span class="badge-cancelled">Cancelled</span>` : ""}
        </div>
        <div class="text-xs text-[var(--text-dim)] font-mono">${r.Circuit.circuitName}</div>
      </td>
      <td class="py-3 px-3 sm:px-4 text-[var(--text-dim)]">${r.Circuit.Location.locality}, ${r.Circuit.Location.country}</td>
      <td class="py-3 px-3 sm:px-4 font-mono text-right">${dateStr}</td>
      <td class="py-3 px-3 sm:px-4 text-right">${statusHtml}</td>
      <td class="py-3 pr-3 sm:pr-4 pl-0 text-right"><span class="chevron text-[var(--red)]">&rsaquo;</span></td>
    </tr>`;
  }).join("");

  contentArea.innerHTML = tableWrap(`
    <thead>
      <tr class="text-left text-[11px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--line)]">
        <th class="py-3 px-3 sm:px-4 font-mono">Rd</th>
        <th class="py-3 px-3 sm:px-4 font-mono">Grand Prix</th>
        <th class="py-3 px-3 sm:px-4 font-mono">Location</th>
        <th class="py-3 px-3 sm:px-4 font-mono text-right">Date</th>
        <th class="py-3 px-3 sm:px-4 font-mono text-right">Status</th>
        <th class="py-3 pr-3 sm:pr-4 pl-0"></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  `);
}

function tableWrap(inner) {
  return `<div class="border border-[var(--line)] rounded-lg overflow-hidden bg-[var(--surface)]">
    <div class="overflow-x-auto">
      <table class="w-full text-sm">${inner}</table>
    </div>
  </div>`;
}

// ---------- Career stats modal ----------

function initials(a, b) {
  return `${(a || "").charAt(0)}${(b || "").charAt(0)}`.toUpperCase();
}

function modalLoadingHtml(title) {
  return `<div class="flex flex-col items-center justify-center py-16 gap-4">
    <div class="spinner"></div>
    <p class="font-mono text-xs text-[var(--text-dim)] uppercase tracking-widest">Pulling career record${title ? " · " + title : ""}…</p>
  </div>`;
}

function modalErrorHtml(msg) {
  return `<div class="py-10 text-center">
    <p class="font-display text-lg font-700" style="font-weight:700;">Couldn't load stats</p>
    <p class="text-sm text-[var(--text-dim)] mt-2">${msg}</p>
  </div>`;
}

async function openDriverModal(driverId) {
  const driver = driverInfoCache[driverId];
  openModal();
  modalContent.innerHTML = modalLoadingHtml(driver ? `${driver.givenName} ${driver.familyName}` : "");

  try {
    let stats = driverStatsCache[driverId];
    if (!stats) {
      const [standingsJson, resultsJson] = await Promise.all([
        fetchJson(`${API_BASE}/drivers/${driverId}/driverStandings.json?limit=200`),
        fetchJson(`${API_BASE}/drivers/${driverId}/results.json?limit=1`),
      ]);
      const lists = standingsJson.MRData.StandingsTable.StandingsLists || [];
      stats = {
        lists,
        careerStarts: parseInt(resultsJson.MRData.total, 10) || null,
      };
      driverStatsCache[driverId] = stats;
    }
    renderDriverModal(driver, stats);
  } catch (err) {
    console.error(err);
    modalContent.innerHTML = modalErrorHtml(err.message || "The API didn't respond. Try again in a moment.");
  }
}

function renderDriverModal(driver, stats) {
  const { lists, careerStarts } = stats;

  if (!lists.length) {
    modalContent.innerHTML = `
      ${driverHeaderHtml(driver)}
      <div class="mt-6">${emptyState("No championship record", "This driver has no season standings on file.")}</div>
    `;
    return;
  }

  const seasons = lists.map(l => parseInt(l.season, 10)).sort((a, b) => a - b);
  const careerWins = lists.reduce((sum, l) => sum + parseInt(l.DriverStandings[0].wins, 10), 0);
  const careerPoints = lists.reduce((sum, l) => sum + parseFloat(l.DriverStandings[0].points), 0);
  const championships = lists.filter(l => l.DriverStandings[0].position === "1").length;
  const bestPosition = Math.min(...lists.map(l => parseInt(l.DriverStandings[0].position, 10)));

  const rowsHtml = [...lists].reverse().map(l => {
    const ds = l.DriverStandings[0];
    const pos = parseInt(ds.position, 10);
    const teams = ds.Constructors.map(c => c.name).join(" / ");
    return `<tr>
      <td class="py-2.5 px-3 sm:px-4 font-mono text-[var(--text-dim)]">${l.season}</td>
      <td class="py-2.5 px-3 sm:px-4">${posBadge(pos)}</td>
      <td class="py-2.5 px-3 sm:px-4 text-[var(--text-dim)]">${teams}</td>
      <td class="py-2.5 px-3 sm:px-4 font-mono text-right">${ds.wins}</td>
      <td class="py-2.5 px-3 sm:px-4 font-mono text-right font-bold">${ds.points}</td>
    </tr>`;
  }).join("");

  modalContent.innerHTML = `
    ${driverHeaderHtml(driver)}
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-6">
      <div class="stat-card"><div class="stat-label">Championships</div><div class="stat-value">${championships}</div></div>
      <div class="stat-card"><div class="stat-label">Career wins</div><div class="stat-value">${careerWins}</div></div>
      <div class="stat-card"><div class="stat-label">Career points</div><div class="stat-value">${careerPoints}</div></div>
      <div class="stat-card"><div class="stat-label">Seasons active</div><div class="stat-value">${lists.length}</div></div>
      <div class="stat-card"><div class="stat-label">Best finish</div><div class="stat-value">P${bestPosition}</div></div>
      <div class="stat-card"><div class="stat-label">Career starts</div><div class="stat-value">${careerStarts ?? "—"}</div></div>
    </div>
    <p class="text-[11px] font-mono text-[var(--text-dim)] mt-4 uppercase tracking-wider">First season ${seasons[0]} · Last season ${seasons[seasons.length - 1]}</p>
    <div class="mt-5 border border-[var(--line)] rounded-lg overflow-hidden">
      <div class="overflow-x-auto max-h-64">
        <table class="w-full text-sm modal-history">
          <thead class="sticky top-0 bg-[var(--surface)]">
            <tr class="text-left text-[11px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--line)]">
              <th class="py-2.5 px-3 sm:px-4 font-mono">Season</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono">Pos</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono">Team</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono text-right">Wins</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono text-right">Points</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function driverHeaderHtml(driver) {
  if (!driver) return "";
  return `<div class="flex items-start gap-4">
    <div class="avatar-ring">${initials(driver.givenName, driver.familyName)}</div>
    <div>
      <h2 class="font-display font-900 text-xl sm:text-2xl leading-tight" style="font-weight:900;">${driver.givenName} ${driver.familyName}</h2>
      <p class="text-sm text-[var(--text-dim)] font-mono mt-0.5">${driver.nationality}${driver.dateOfBirth ? " · Born " + driver.dateOfBirth : ""}${driver.code ? " · " + driver.code : ""}${driver.permanentNumber ? " · #" + driver.permanentNumber : ""}</p>
    </div>
  </div>`;
}

async function openConstructorModal(constructorId) {
  const constructor = constructorInfoCache[constructorId];
  openModal();
  modalContent.innerHTML = modalLoadingHtml(constructor ? constructor.name : "");

  try {
    let stats = constructorStatsCache[constructorId];
    if (!stats) {
      const [standingsJson, resultsJson] = await Promise.all([
        fetchJson(`${API_BASE}/constructors/${constructorId}/constructorStandings.json?limit=200`),
        fetchJson(`${API_BASE}/constructors/${constructorId}/results.json?limit=1`),
      ]);
      const lists = standingsJson.MRData.StandingsTable.StandingsLists || [];
      stats = {
        lists,
        careerEntries: parseInt(resultsJson.MRData.total, 10) || null,
      };
      constructorStatsCache[constructorId] = stats;
    }
    renderConstructorModal(constructor, stats);
  } catch (err) {
    console.error(err);
    modalContent.innerHTML = modalErrorHtml(err.message || "The API didn't respond. Try again in a moment.");
  }
}

function renderConstructorModal(constructor, stats) {
  const { lists, careerEntries } = stats;

  if (!lists.length) {
    modalContent.innerHTML = `
      ${constructorHeaderHtml(constructor)}
      <div class="mt-6">${emptyState("No championship record", "This constructor has no season standings on file.")}</div>
    `;
    return;
  }

  const seasons = lists.map(l => parseInt(l.season, 10)).sort((a, b) => a - b);
  const careerWins = lists.reduce((sum, l) => sum + parseInt(l.ConstructorStandings[0].wins, 10), 0);
  const careerPoints = lists.reduce((sum, l) => sum + parseFloat(l.ConstructorStandings[0].points), 0);
  const championships = lists.filter(l => l.ConstructorStandings[0].position === "1").length;
  const bestPosition = Math.min(...lists.map(l => parseInt(l.ConstructorStandings[0].position, 10)));

  const rowsHtml = [...lists].reverse().map(l => {
    const cs = l.ConstructorStandings[0];
    const pos = parseInt(cs.position, 10);
    return `<tr>
      <td class="py-2.5 px-3 sm:px-4 font-mono text-[var(--text-dim)]">${l.season}</td>
      <td class="py-2.5 px-3 sm:px-4">${posBadge(pos)}</td>
      <td class="py-2.5 px-3 sm:px-4 font-mono text-right">${cs.wins}</td>
      <td class="py-2.5 px-3 sm:px-4 font-mono text-right font-bold">${cs.points}</td>
    </tr>`;
  }).join("");

  modalContent.innerHTML = `
    ${constructorHeaderHtml(constructor)}
    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-6">
      <div class="stat-card"><div class="stat-label">Championships</div><div class="stat-value">${championships}</div></div>
      <div class="stat-card"><div class="stat-label">Career wins</div><div class="stat-value">${careerWins}</div></div>
      <div class="stat-card"><div class="stat-label">Career points</div><div class="stat-value">${careerPoints}</div></div>
      <div class="stat-card"><div class="stat-label">Seasons active</div><div class="stat-value">${lists.length}</div></div>
      <div class="stat-card"><div class="stat-label">Best finish</div><div class="stat-value">P${bestPosition}</div></div>
      <div class="stat-card"><div class="stat-label">Career entries</div><div class="stat-value">${careerEntries ?? "—"}</div></div>
    </div>
    <p class="text-[11px] font-mono text-[var(--text-dim)] mt-4 uppercase tracking-wider">First season ${seasons[0]} · Last season ${seasons[seasons.length - 1]}</p>
    <div class="mt-5 border border-[var(--line)] rounded-lg overflow-hidden">
      <div class="overflow-x-auto max-h-64">
        <table class="w-full text-sm modal-history">
          <thead class="sticky top-0 bg-[var(--surface)]">
            <tr class="text-left text-[11px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--line)]">
              <th class="py-2.5 px-3 sm:px-4 font-mono">Season</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono">Pos</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono text-right">Wins</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono text-right">Points</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;
}

function constructorHeaderHtml(constructor) {
  if (!constructor) return "";
  const parts = constructor.name.split(" ");
  return `<div class="flex items-start gap-4">
    <div class="avatar-ring">${initials(parts[0], parts[1] || parts[0])}</div>
    <div>
      <h2 class="font-display font-900 text-xl sm:text-2xl leading-tight" style="font-weight:900;">${constructor.name}</h2>
      <p class="text-sm text-[var(--text-dim)] font-mono mt-0.5">${constructor.nationality}</p>
    </div>
  </div>`;
}

// ---------- Race results modal ----------

const raceResultsCache = {}; // key: `${season}-${round}` -> Results array

async function openRaceModal(season, round, raceName, isCancelled, hasResults) {
  openModal();

  if (isCancelled) {
    modalContent.innerHTML = raceCancelledHtml(raceName, season, round);
    return;
  }
  if (!hasResults) {
    modalContent.innerHTML = raceNoResultsYetHtml(raceName, season, round);
    return;
  }

  modalContent.innerHTML = modalLoadingHtml(raceName);
  const cacheKey = `${season}-${round}`;
  try {
    let results = raceResultsCache[cacheKey];
    if (!results) {
      const json = await fetchJson(`${API_BASE}/${season}/${round}/results.json?limit=40`);
      results = json.MRData.RaceTable.Races[0]?.Results || [];
      raceResultsCache[cacheKey] = results;
    }
    renderRaceModal(raceName, season, round, results);
  } catch (err) {
    console.error(err);
    modalContent.innerHTML = modalErrorHtml(err.message || "The API didn't respond. Try again in a moment.");
  }
}

function raceHeaderHtml(raceName, season, round) {
  return `<div>
    <p class="text-[11px] uppercase tracking-[0.2em] text-[var(--red)] font-mono font-bold">Round ${round} · ${season}</p>
    <h2 class="font-display font-900 text-xl sm:text-2xl leading-tight mt-1" style="font-weight:900;">${raceName}</h2>
  </div>`;
}

function raceCancelledHtml(raceName, season, round) {
  return `${raceHeaderHtml(raceName, season, round)}
    <div class="mt-6 border border-[var(--red-dim)] rounded-lg bg-[var(--surface-2)] px-6 py-10 text-center">
      <span class="badge-cancelled">Cancelled</span>
      <p class="text-sm text-[var(--text-dim)] mt-3 max-w-sm mx-auto">This Grand Prix was on the ${season} calendar but never took place, so no results were ever classified for it.</p>
    </div>`;
}

function raceNoResultsYetHtml(raceName, season, round) {
  return `${raceHeaderHtml(raceName, season, round)}
    <div class="mt-6 border border-[var(--line)] rounded-lg bg-[var(--surface-2)] px-6 py-10 text-center">
      <p class="font-display text-lg font-700" style="font-weight:700;">Not run yet</p>
      <p class="text-sm text-[var(--text-dim)] mt-2">This race hasn't happened yet, so there's no classification to show.</p>
    </div>`;
}

function renderRaceModal(raceName, season, round, results) {
  if (!results.length) {
    modalContent.innerHTML = `${raceHeaderHtml(raceName, season, round)}
      <div class="mt-6">${emptyState("No results found", "The API returned no classified results for this round.")}</div>`;
    return;
  }

  const rows = results.map(res => {
    const pos = res.positionText === "R" || isNaN(parseInt(res.position, 10)) ? null : parseInt(res.position, 10);
    return `<tr class="${pos ? podiumClass(pos) : ""}">
      <td class="py-2.5 px-3 sm:px-4">${pos ? posBadge(pos) : `<span class="pos-badge">${res.positionText}</span>`}</td>
      <td class="py-2.5 px-3 sm:px-4">
        <div class="font-semibold">${res.Driver.givenName} ${res.Driver.familyName}</div>
        <div class="text-xs text-[var(--text-dim)] font-mono">${res.Constructor.name}</div>
      </td>
      <td class="py-2.5 px-3 sm:px-4 font-mono text-[var(--text-dim)] text-right">${res.grid === "0" ? "PL" : res.grid}</td>
      <td class="py-2.5 px-3 sm:px-4 font-mono text-[var(--text-dim)] text-right">${res.laps}</td>
      <td class="py-2.5 px-3 sm:px-4 text-[var(--text-dim)] text-right">${res.status}</td>
      <td class="py-2.5 px-3 sm:px-4 font-mono font-bold text-right">${res.points}</td>
    </tr>`;
  }).join("");

  modalContent.innerHTML = `
    ${raceHeaderHtml(raceName, season, round)}
    <div class="mt-5 border border-[var(--line)] rounded-lg overflow-hidden">
      <div class="overflow-x-auto max-h-96">
        <table class="w-full text-sm modal-history">
          <thead class="sticky top-0 bg-[var(--surface)]">
            <tr class="text-left text-[11px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--line)]">
              <th class="py-2.5 px-3 sm:px-4 font-mono">Pos</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono">Driver</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono text-right">Grid</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono text-right">Laps</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono text-right">Status</th>
              <th class="py-2.5 px-3 sm:px-4 font-mono text-right">Points</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

let countdownTimer = null;
function updateCountdown(targetDate) {
  clearInterval(countdownTimer);
  const el = document.getElementById("nextRaceCountdown");
  function tick() {
    const diff = targetDate - new Date();
    if (diff <= 0) {
      el.textContent = "Lights out";
      clearInterval(countdownTimer);
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

loadTab();
