"use strict";

// This screen follows the same browser -> api.js -> server -> database -> back
// round trip explained in full in client/js/screens/departments.js — just
// with an extra rule the database enforces: every row for one employee code,
// added together (no matter how many different roles/metrics they have), must
// equal exactly 100%. If you try to save a row that breaks that total, the
// database itself refuses the save and sends back an error message, which is
// what you'd see as an alert on screen.

// Which of the three sub-pages is currently showing, without changing the
// web address — "search" is the filter form, "results" is the matching list,
// "edit" is one person's editable rows.
let _empView = "search"; // "search" | "results" | "edit"
// Whatever was last typed into the three search boxes, kept so the search form
// can be redrawn showing what was searched for.
let _empSearchCriteria = { name: "", empCode: "", officeCode: "" };
// The matching people from the last search, grouped as [[empCode, rows], ...].
let _empResults = [];
// Which employee code is currently open in the Edit view.
let _empEditCode = null;

// These hold the data fetched from the server that every view on this page needs.
let _employees = [];
let _empDepartments = [];
let _empRoles = [];
let _empKpas = [];
// Remembers which Role was last picked on the Add Employee form, so it stays
// selected if the form redraws.
let _empFormRoleId = null;

// Fetches everything this screen needs from the server, all at once, and
// waits for all four requests to finish before continuing (Promise.all runs
// them at the same time rather than one after another, which is faster).
async function loadEmployeeLookups() {
  [_employees, _empDepartments, _empRoles, _empKpas] = await Promise.all([
    api.employees.list(),
    api.departments.list(),
    api.roles.list(),
    api.kpas.list(),
  ]);
}

// The main entry point for this whole screen — called every time the
// "Employees" page needs to be drawn or redrawn.
async function renderEmployees(app) {
  // Always refresh the data first, so every view shows the latest saved state.
  await loadEmployeeLookups();

  // Safety check: if we were editing someone whose last row just got deleted
  // (e.g. from another tab, or this screen itself), fall back to the results
  // list instead of showing a blank/broken edit page.
  if (_empView === "edit" && !_employees.some((r) => r.empCode === _empEditCode)) {
    _empView = "results";
  }

  // Draw whichever of the three sub-pages is currently active.
  if (_empView === "results") {
    renderEmployeeResultsView(app);
  } else if (_empView === "edit") {
    renderEmployeeEditView(app);
  } else {
    renderEmployeeSearchView(app);
  }
}

// Draws the first sub-page: the search form.
function renderEmployeeSearchView(app) {
  const c = _empSearchCriteria;
  app.innerHTML = `
    <div class="card">
      <h2 class="screen-title">Employees — Search</h2>
      <p class="screen-desc">Search for an existing employee to view or edit their Role/KPA rows. Leave fields blank to list everyone.</p>
      <!-- Three filter boxes, pre-filled with whatever was searched last time -->
      <div class="form-grid">
        <div><label>Employee Name</label><input id="empSearchName" value="${esc(c.name)}" placeholder="e.g. Sharma"></div>
        <div><label>Employee Code</label><input id="empSearchCode" value="${esc(c.empCode)}" placeholder="e.g. EMP1001"></div>
        <div><label>Office Code</label><input id="empSearchOffice" value="${esc(c.officeCode)}" placeholder="e.g. RO-CHN"></div>
      </div>
      <div style="margin-top:14px">
        <button class="primary" onclick="runEmployeeSearch()">Search</button>
        <button onclick="closeEmployeeSearch()">Close</button>
        <button style="float:right" onclick="goToAddEmployee()">+ Add Employee</button>
      </div>
    </div>`;
}

// Runs when "Search" is clicked. Filters the already-downloaded employee list
// in the browser (no new server request needed) and switches to the Results view.
function runEmployeeSearch() {
  // Remember exactly what was typed, trimmed of extra spaces, so it can be shown again later.
  _empSearchCriteria = {
    name: document.getElementById("empSearchName").value.trim(),
    empCode: document.getElementById("empSearchCode").value.trim(),
    officeCode: document.getElementById("empSearchOffice").value.trim(),
  };

  // Lowercase versions of each search term, for case-insensitive matching.
  const nameNeedle = _empSearchCriteria.name.toLowerCase();
  const codeNeedle = _empSearchCriteria.empCode.toLowerCase();
  const officeNeedle = _empSearchCriteria.officeCode.toLowerCase();

  // Group every employee row by their employee code, since one person can
  // have several rows (one per role/metric).
  const byCode = {};
  _employees.forEach((r) => { (byCode[r.empCode] = byCode[r.empCode] || []).push(r); });

  // Keep only the people whose name/code/office contain what was typed
  // (a blank search box means "don't filter on this field at all").
  _empResults = Object.keys(byCode)
    .filter((code) => {
      const rows = byCode[code];
      const matchesName = !nameNeedle || rows[0].name.toLowerCase().includes(nameNeedle);
      const matchesCode = !codeNeedle || code.toLowerCase().includes(codeNeedle);
      const matchesOffice = !officeNeedle || rows.some((r) => (r.officeCode || "").toLowerCase().includes(officeNeedle));
      return matchesName && matchesCode && matchesOffice;
    })
    .sort() // alphabetical by employee code
    .map((code) => [code, byCode[code]]); // turn back into [[code, rows], ...] pairs

  // Switch to the Results view and redraw.
  _empView = "results";
  router();
}

// Runs when "Close" is clicked — clears the search boxes back to blank.
function closeEmployeeSearch() {
  _empSearchCriteria = { name: "", empCode: "", officeCode: "" };
  router();
}

// Draws the second sub-page: the list of people matching the last search.
function renderEmployeeResultsView(app) {
  app.innerHTML = `
    <div class="card">
      <h2 class="screen-title">Employees — Search Results</h2>
      <p class="screen-desc">${_empResults.length} employee${_empResults.length === 1 ? "" : "s"} matched. Click a row to view or edit.</p>
      <div style="margin-bottom:14px"><button onclick="backToEmployeeSearch()">&larr; Back to Search</button></div>
      <!-- Only draw the table if there's at least one match; otherwise show a plain message -->
      ${_empResults.length === 0 ? `<p class="muted">No employees match your search.</p>` : `
      <table>
        <thead><tr><th>Employee Code</th><th>Name</th><th>Department</th><th>Office</th><th>Roles / KPAs</th><th>Total Weightage</th><th></th></tr></thead>
        <tbody>
          <!-- One row per matching person; clicking anywhere on the row opens their Edit view -->
          ${_empResults.map(([code, rows]) => {
            // Add up this person's weightage across all of their rows, to show whether it's a valid 100%.
            const total = rows.reduce((s, r) => s + (parseFloat(r.weightagePct) || 0), 0);
            return `
            <tr onclick="openEmployeeEdit('${esc(code)}')" style="cursor:pointer">
              <td>${esc(code)}</td>
              <td>${esc(rows[0].name)}</td>
              <td>${esc(rows[0].departmentName)}</td>
              <td>${esc(rows[0].officeCode)}</td>
              <td>${rows.length} row${rows.length === 1 ? "" : "s"}</td>
              <td><span class="${total === 100 ? "total-ok" : "total-bad"}">${total}%</span></td>
              <td><button class="small" onclick="event.stopPropagation(); openEmployeeEdit('${esc(code)}')">Open</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`}
    </div>`;
}

// Runs when a result row (or its "Open" button) is clicked — switches to
// editing that one person.
function openEmployeeEdit(code) {
  _empEditCode = code;
  _empView = "edit";
  router();
}

// "Back to Search" button handler.
function backToEmployeeSearch() {
  _empView = "search";
  router();
}

// "Back to Results" button handler.
function backToEmployeeResults() {
  _empView = "results";
  router();
}

// Draws the third sub-page: one person's editable rows.
function renderEmployeeEditView(app) {
  // Find every row belonging to the person currently being edited.
  const rows = _employees.filter((r) => r.empCode === _empEditCode);
  app.innerHTML = `
    <div class="card">
      <h2 class="screen-title">Employees — Edit</h2>
      <p class="screen-desc">All of this person's rows — regardless of role — must sum to 100% weightage.</p>
      <div style="margin-bottom:14px"><button onclick="backToEmployeeResults()">&larr; Back to Results</button></div>
      <!-- If somehow this person has no rows left, say so; otherwise draw their editable table -->
      ${rows.length === 0 ? `<p class="muted">This employee no longer has any rows.</p>` : renderPersonBlock(_empEditCode, rows)}
    </div>`;
}

// Builds the editable table for one person's rows: each row lets you change
// its Role's KPA and weightage, or remove the row entirely.
function renderPersonBlock(code, rows) {
  // Add up all of this person's weightages, to show the 100% check at the top.
  const total = rows.reduce((s, r) => s + (parseFloat(r.weightagePct) || 0), 0);
  return `
    <div class="person-block">
      <div class="person-head">
        <div><b>${esc(rows[0].name)}</b> <span class="muted">(${esc(code)})</span></div>
        <div>Total weightage: <span class="${total === 100 ? "total-ok" : "total-bad"}">${total}%</span> ${total === 100 ? "✓" : "✗ must equal 100%"}</div>
      </div>
      <table>
        <thead><tr><th>Role</th><th>KPA</th><th>Weightage %</th><th>Dept</th><th>Office</th><th>Start</th><th></th></tr></thead>
        <tbody>
          <!-- One row per role/KPA this person has. The KPA dropdown and
               weightage box save immediately when changed; Remove deletes the row. -->
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.roleName)}</td>
              <td>
                <select onchange="updateEmployeeKpa(${r.id}, this.value)">
                  ${_empKpas.map((k) => `<option value="${k.id}" ${k.id === r.kpaId ? "selected" : ""}>${esc(k.name)} (${esc(k.code)})</option>`).join("")}
                </select>
              </td>
              <td><input type="number" step="any" value="${r.weightagePct}" onchange="updateEmployeeWeight(${r.id}, this.value)"></td>
              <td>${esc(r.departmentName)}</td>
              <td>${esc(r.officeCode)}</td>
              <td>${esc(r.startDate)}</td>
              <td><button class="danger small" onclick="deleteEmployeeRow(${r.id})">Remove</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------------------
// Add Employee — its own page/route (#/employees/add)
// ---------------------------------------------------------------------------

// Draws the separate Add Employee page.
async function renderEmployeeAdd(app) {
  // Make sure the dropdowns (departments/roles/KPAs) have fresh data.
  await loadEmployeeLookups();
  app.innerHTML = `
    <div class="card">
      <h2 class="screen-title">Add Employee</h2>
      <p class="screen-desc">Use this both to add a brand-new person's first row, or to add another KPA/role to an existing person (match their Employee Code).</p>
      ${renderAddEmployeeRowForm()}
    </div>`;
}

// Changing the page's web address to #/employees/add is all that's needed to
// navigate there — the router (router.js) notices the change and draws this page.
function goToAddEmployee() {
  window.location.hash = "#/employees/add";
}

// Builds the "Add a row" form shared by the Add Employee page.
function renderAddEmployeeRowForm() {
  // Default the Role dropdown to whatever was last picked, or the first available one.
  const roleId = _empFormRoleId || (_empRoles[0] && _empRoles[0].id) || "";
  return `
    <div class="form-grid">
      <div><label>Employee Code</label><input id="empCodeInput" placeholder="e.g. EMP1004"></div>
      <div><label>Name</label><input id="empNameInput" placeholder="Full name"></div>
      <div><label>Department</label>
        <select id="empDeptInput">${_empDepartments.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select>
      </div>
      <div><label>Office Code</label><input id="empOfficeInput" placeholder="e.g. RO-CHN"></div>
      <div><label>Role</label>
        <select id="empRoleInput" onchange="_empFormRoleId=this.value; router();">
          ${_empRoles.map((r) => `<option value="${r.id}" ${r.id === roleId ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
        </select>
      </div>
      <div><label>KPI Name</label>
        <select id="empKpaInput" onchange="autoFetchKpiId()">
          ${_empKpas.length === 0 ? `<option value="">— no KPAs exist yet —</option>` :
            _empKpas.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join("")}
        </select>
      </div>
      <div><label>KPI Code (auto-fetched)</label><input id="empKpaIdDisplay" disabled value="${_empKpas[0] ? _empKpas[0].code : ""}"></div>
      <div><label>Weightage %</label><input id="empWeightInput" type="number" step="any" value="0"></div>
      <div><label>Start Date</label><input id="empStartInput" type="date" value="${todayStr()}"></div>
    </div>
    <div style="margin-top:10px">
      <button class="primary" onclick="addEmployeeRow()">Add row</button>
      <button onclick="window.location.hash='#/employees'">Cancel</button>
    </div>
  `;
}

// Runs when the KPI Name dropdown changes — just copies that KPA's code into
// the read-only box next to it, purely for display (doesn't change anything saved).
function autoFetchKpiId() {
  const sel = document.getElementById("empKpaInput");
  const kpa = _empKpas.find((k) => String(k.id) === sel.value);
  document.getElementById("empKpaIdDisplay").value = kpa ? kpa.code : "";
}

// Runs when "Add row" is clicked on the Add Employee page.
async function addEmployeeRow() {
  // Read the required text fields, trimmed of extra spaces.
  const empCode = document.getElementById("empCodeInput").value.trim();
  const name = document.getElementById("empNameInput").value.trim();
  const kpaId = document.getElementById("empKpaInput").value;
  // Stop here with a message if the required fields weren't filled in.
  if (!empCode || !name) return alert("Employee Code and Name are required.");
  if (!kpaId) return alert("No KPA available — add a KPA on the KPAs screen first.");

  try {
    // Send everything typed/selected in the form to the server to be saved
    // as a new employee row.
    await api.employees.create({
      empCode,
      name,
      departmentId: document.getElementById("empDeptInput").value || null,
      officeCode: document.getElementById("empOfficeInput").value,
      roleId: document.getElementById("empRoleInput").value,
      kpaId,
      weightagePct: document.getElementById("empWeightInput").value,
      startDate: document.getElementById("empStartInput").value,
    });
    // On success, send the person back to the Employees search page.
    _empView = "search";
    window.location.hash = "#/employees";
  } catch (err) {
    // e.g. the database will refuse this if it would push the person's total past/under 100%.
    alert(err.message);
  }
}

// ---------------------------------------------------------------------------
// Row-level edit actions (used from the Edit view)
// ---------------------------------------------------------------------------

// Runs when a weightage box is edited on the Edit view.
async function updateEmployeeWeight(id, val) {
  try {
    // Find this row's current data in memory, so its KPA can be sent along
    // unchanged (the server expects both fields together on an update).
    const row = _employees.find((e) => e.id === id);
    await api.employees.update(id, { kpaId: row.kpaId, weightagePct: val });
    // Redraw to show the saved value and updated 100% total.
    router();
  } catch (err) {
    // e.g. the database refused because the new total no longer equals 100%.
    alert(err.message);
    // Redraw anyway, so the box resets back to the last value that actually saved.
    router();
  }
}

// Runs when a row's KPA dropdown is changed on the Edit view.
async function updateEmployeeKpa(id, kpaId) {
  try {
    const row = _employees.find((e) => e.id === id);
    // Check in the browser first whether this person already has a row for
    // this exact Role + KPA combination, to give a clearer message than
    // whatever the database's "must be unique" error would say.
    const dup = _employees.some((o) => o.id !== id && o.empCode === row.empCode && o.roleId === row.roleId && String(o.kpaId) === kpaId);
    if (dup) return alert("This person already has a row for this Role + KPA combination.");
    await api.employees.update(id, { kpaId, weightagePct: row.weightagePct });
    router();
  } catch (err) {
    alert(err.message);
    router();
  }
}

// Runs when a row's "Remove" button is clicked on the Edit view.
async function deleteEmployeeRow(id) {
  // Confirm first — removing a row can't be undone.
  if (!confirm("Remove this row?")) return;
  try {
    await api.employees.remove(id);
    router();
  } catch (err) {
    alert(err.message);
  }
}
