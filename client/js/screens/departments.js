"use strict";

// This file draws the "Departments" page in the browser and reacts to clicks.
// It's the simplest example in this app of the full round-trip: browser screen
// -> api.js (the messenger) -> the server -> the database -> and back again to
// the screen. Every other screen in this app (Roles, KPAs, Employees, etc.)
// follows this exact same pattern, just with more fields and extra rules.

async function renderDepartments(app) {
  // Go ask the server for the full, up-to-date list of departments, and pause
  // here until the answer comes back (that's what "await" means).
  const rows = await api.departments.list();
  // Replace everything currently on screen with the HTML written out below —
  // this is what actually makes the page appear. The <!-- --> notes inside
  // explain what each piece of that HTML is for.
  app.innerHTML = `
    <div class="card">
      <!-- Page heading and a one-line explanation of what this screen is for -->
      <h2 class="screen-title">Departments</h2>
      <p class="screen-desc">A simple controlled list — used everywhere else instead of free-text department names.</p>
      <!-- The box you type a new department's name into, plus the Add button that saves it -->
      <div class="inline-form-row">
        <div><label>New department name</label><input id="deptNameInput" placeholder="e.g. Underwriting"></div>
        <div style="flex:0"><button class="primary" onclick="addDepartment()">Add</button></div>
      </div>
      <table>
        <thead><tr><th>Name</th><th></th></tr></thead>
        <tbody>
          <!-- One row per department already saved. The name box lets you edit
               it in place (saves the moment you click away); Delete removes it. -->
          ${rows.map((d) => `
            <tr>
              <td><input value="${esc(d.name)}" onchange="renameDepartment(${d.id}, this.value)"></td>
              <td class="row-actions"><button class="danger small" onclick="deleteDepartment(${d.id})">Delete</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

// Runs when the "Add" button is clicked.
// Step 1: grab whatever text the person typed into the "New department name" box.
// Step 2: hand it to api.departments.create(...) — that function (in api.js) sends
//   it over the network to the server, which saves it in the database and sends
//   the newly-saved row back.
// Step 3: once that finishes, call router() to redraw the page so the new
//   department shows up in the list immediately.
async function addDepartment() {
  // Find the "New department name" text box on the page by its id.
  const input = document.getElementById("deptNameInput");
  try {
    // Send the typed name to the server to be saved as a new department row.
    await api.departments.create({ name: input.value });
    // Redraw the page so the newly-added department appears in the list.
    router();
  } catch (err) {
    // If the server rejected it (e.g. blank name, or that name already exists),
    // show the reason in a popup instead of silently failing.
    alert(err.message);
  }
}

// Runs when a department's name box is edited and you click away from it.
async function renameDepartment(id, name) {
  try {
    // Tell the server to update this specific department's row (matched by its id).
    await api.departments.update(id, { name });
    // Redraw the page to reflect the saved change.
    router();
  } catch (err) {
    // Show the server's rejection reason, if any.
    alert(err.message);
    // Redraw anyway, so the box resets back to the last value that actually saved.
    router();
  }
}

// Runs when a department row's "Delete" button is clicked.
async function deleteDepartment(id) {
  // Ask for confirmation first, since deleting can't be undone — if the person
  // clicks "Cancel", stop here and do nothing.
  if (!confirm("Delete this department?")) return;
  try {
    // Tell the server to remove this department's row from the database.
    await api.departments.remove(id);
    // Redraw the page so the deleted department disappears from the list.
    router();
  } catch (err) {
    // e.g. the server will refuse if an employee is still assigned to this department.
    alert(err.message);
  }
}
