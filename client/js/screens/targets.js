"use strict";

// Same browser -> api.js -> server -> database pattern as every other screen
// (see client/js/screens/departments.js for the full walkthrough). What's
// different here: saving a target doesn't just save a target. The database
// is set up (in schema.sql) so that the instant a target row is saved, it
// automatically creates the matching "Work Allocation Order" — the record
// that tracks the employee's actual result for that month — with no extra
// step from this screen or the server. That's why the table below already
// shows a status for every target as soon as it's added.

// The full employee list, kept so typing in the search box can be matched
// against it without asking the server again on every keystroke.
let _targetEmployees = [];

// Builds the text shown for one employee in the search suggestions —
// e.g. "EMP1001 — Priya Sharma — Branch Manager — Premium Growth".
function targetEmpLabel(e) {
  return `${e.empCode} — ${e.name} — ${e.roleName} — ${e.kpaName}`;
}

async function renderTargets(app) {
  // Fetch the employee list (for the search box) and every target saved so
  // far (for the table below), both at the same time.
  const [employees, targets] = await Promise.all([api.employees.list(), api.targets.list()]);
  _targetEmployees = employees;

  app.innerHTML = `
    <div class="card">
      <h2 class="screen-title">Target Fixation</h2>
      <p class="screen-desc">No acceptance step: the moment a target is saved here, it's live and its Work Allocation Order is created immediately.</p>
      <div class="form-grid">
        <!-- Typing here searches the datalist suggestions below; picking one
             fills the hidden "targetEmpInput" box with that row's real id -->
        <div><label>Employee row — search by Employee Code</label>
          <input id="targetEmpSearchInput" list="targetEmpDatalist" placeholder="Type Employee Code, e.g. EMP1001" autocomplete="off" oninput="resolveTargetEmp(this.value)">
          <datalist id="targetEmpDatalist">
            ${employees.map((e) => `<option value="${esc(targetEmpLabel(e))}">`).join("")}
          </datalist>
          <input type="hidden" id="targetEmpInput">
        </div>
        <div><label>Period (YYYY-MM)</label><input id="targetPeriodInput" placeholder="e.g. 2026-07"></div>
        <div><label>Target value <span id="targetUnitHint" class="muted"></span></label><input id="targetValueInput" type="number" step="any"></div>
        <div><label>Set by (authority)</label><input id="targetSetByInput" placeholder="e.g. RO Marketing Head"></div>
      </div>
      <div style="margin-top:10px"><button class="primary" onclick="addTarget()">Fix target (creates Work Allocation Order immediately)</button></div>
    </div>
    <div class="card">
      <h2 class="screen-title">All targets</h2>
      <!-- If no targets exist yet, say so; otherwise list every one, including
           the status of the work order it automatically created -->
      ${targets.length === 0 ? `<p class="muted">No targets fixed yet.</p>` : `
      <table>
        <thead><tr><th>Employee</th><th>Period</th><th>Target</th><th>Set by</th><th>Work Allocation Order status</th></tr></thead>
        <tbody>
          ${targets.map((t) => `
            <tr>
              <td>${esc(t.empCode)} — ${esc(t.employeeName)} — ${esc(t.roleName)} — ${esc(t.kpaName)}</td>
              <td>${esc(t.period)}</td>
              <td>${t.targetValue} ${esc(t.kpaUnit || "")}</td>
              <td>${esc(t.setBy)}</td>
              <td>${t.waoStatus ? statusBadge(t.waoStatus) : "<span class='muted'>—</span>"}</td>
            </tr>`).join("")}
        </tbody>
      </table>`}
    </div>`;
}

// Runs on every keystroke in the employee search box. If what's typed exactly
// matches one of the suggestions, remember that row's real database id (in
// the hidden box) and show its metric's unit (e.g. "%", "days") as a hint.
function resolveTargetEmp(text) {
  const match = _targetEmployees.find((e) => targetEmpLabel(e) === text);
  document.getElementById("targetEmpInput").value = match ? match.id : "";
  document.getElementById("targetUnitHint").textContent = match ? match.kpaUnit || "" : "";
}

// Runs when "Fix target" is clicked.
async function addTarget() {
  // Read every field from the form.
  const employeeId = document.getElementById("targetEmpInput").value;
  const period = document.getElementById("targetPeriodInput").value.trim();
  const targetValue = document.getElementById("targetValueInput").value;
  const setBy = document.getElementById("targetSetByInput").value.trim();
  // Stop here if no valid employee row was actually picked from the suggestions.
  if (!employeeId) return alert("Search for and select a valid Employee Code first.");

  try {
    // Save the target — the database automatically creates its Work
    // Allocation Order as a side effect of this one save (see the block
    // comment at the top of this file).
    await api.targets.create({ employeeId, period, targetValue, setBy });
    // Redraw so the new target (and its freshly-created order) appears in the table.
    router();
  } catch (err) {
    alert(err.message);
  }
}
