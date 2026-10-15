"use strict";

// Same browser -> api.js -> server -> database pattern as every other screen
// (see client/js/screens/departments.js). This screen just displays a number
// the database works out for us: for every metric a person has, take its
// mark and multiply it by how much that metric is worth (its weight), then
// add all of those up — that total, out of 100, is the "Final KPI Score".
// Only metrics whose Work Allocation Order has reached "Accepted" count
// towards it; anything still waiting on entry or review shows as blank.

// Which employee code and which month are currently selected.
let _dashCode = null;
let _dashPeriod = "";

async function renderDashboard(app) {
  // Fetch every employee row, just to build the "pick a person" dropdown.
  const employees = await api.employees.list();
  // Build a de-duplicated [[code, name], ...] list — one entry per person,
  // even though they may have several rows (one per role/metric).
  const codes = [...new Map(employees.map((e) => [e.empCode, e.name])).entries()];

  // If nothing is selected yet, default to the first person in the list.
  if (!_dashCode && codes.length) _dashCode = codes[0][0];

  app.innerHTML = `
    <div class="card">
      <h2 class="screen-title">KPI Score Dashboard</h2>
      <p class="screen-desc">Flat weighted sum of mark × weightage across a person's KPA-rows. Only counts Work Allocation Orders with status Accepted.</p>
      <!-- If no employees exist at all, say so; otherwise show the person/month pickers -->
      ${codes.length === 0 ? `<p class="muted">No employees exist yet — add one on the Employees screen first.</p>` : `
      <div class="inline-form-row">
        <div><label>Employee</label>
          <select onchange="_dashCode=this.value; router();">
            ${codes.map(([code, name]) => `<option value="${code}" ${code === _dashCode ? "selected" : ""}>${esc(code)} — ${esc(name)}</option>`).join("")}
          </select>
        </div>
        <div><label>Period (YYYY-MM)</label><input value="${esc(_dashPeriod)}" placeholder="e.g. 2026-07" onchange="_dashPeriod=this.value; router();"></div>
      </div>
      <hr class="section-divider">
      <div id="dashboardResult"></div>
      `}
    </div>`;

  // Only actually fetch/show a score once both a person and a validly-formatted
  // month (YYYY-MM) are selected; otherwise just prompt for the month.
  if (codes.length && _dashCode && /^[0-9]{4}-(0[1-9]|1[0-2])$/.test(_dashPeriod)) {
    await renderDashboardResult();
  } else if (codes.length) {
    document.getElementById("dashboardResult").innerHTML = `<p class="muted">Enter a period in YYYY-MM format to see scores.</p>`;
  }
}

// Fetches and draws the actual score table/final number for the selected
// person and month.
async function renderDashboardResult() {
  const container = document.getElementById("dashboardResult");
  let data;
  try {
    // Ask the server for this person's already-computed score breakdown for this month.
    data = await api.dashboard.get(_dashCode, _dashPeriod);
  } catch (err) {
    // Show the error in place of the score, and stop here.
    container.innerHTML = `<p class="error-banner">${esc(err.message)}</p>`;
    return;
  }

  // Make sure the final score is treated as a real number (falls back to 0 if missing).
  const final = parseFloat(data.finalScore) || 0;

  container.innerHTML = `
    <table>
      <thead><tr><th>KPA (via role)</th><th>Weightage</th><th>Actual</th><th>Mark</th><th>Weighted</th></tr></thead>
      <tbody>
        <!-- One row per metric this person is scored on; blanks shown for
             anything not yet entered/accepted -->
        ${data.lines.map((line) => `
          <tr>
            <td>${esc(line.kpaName)} <span class="muted">(${esc(line.roleName)})</span></td>
            <td>${line.weightagePct}%</td>
            <td>${line.actualValue !== null ? line.actualValue : `<span class="muted">— not yet entered/accepted</span>`}</td>
            <td>${line.mark !== null ? line.mark : "—"}</td>
            <td>${line.weightedScore === null ? "—" : parseFloat(line.weightedScore).toFixed(1)}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    <!-- The big final number, plus a note on whether every metric has been scored yet -->
    <div class="score-final">
      <div>
        <div style="font-size:10.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--slate-500)">Final KPI Score</div>
        <div>${final.toFixed(1)}<span style="font-size:14px;font-weight:600;color:var(--slate-500)"> / 100</span></div>
      </div>
      ${data.kpasScored < data.kpasTotal ? `<span class="score-note">Partial — ${data.kpasScored} of ${data.kpasTotal} KPAs scored</span>` : `<span class="badge accepted">Complete</span>`}
    </div>`;
}
