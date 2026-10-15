"use strict";

// Same browser -> api.js -> server -> database pattern as every other screen
// (see client/js/screens/departments.js for the full plain-language walkthrough).

async function renderRoles(app) {
  // Ask the server for the full list of job-role types.
  const rows = await api.roles.list();
  // Draw the page: a form to add a new role, then a table of existing ones.
  app.innerHTML = `
    <div class="card">
      <h2 class="screen-title">Roles</h2>
      <p class="screen-desc">Job types. A Role's KPAs and weightages are assigned directly per person on the Employees screen — there is no separate template.</p>
      <!-- The "Add role" form: name, Fixed/Tailor-made type, and a free-text description -->
      <div class="form-grid">
        <div><label>Name</label><input id="roleNameInput" placeholder="e.g. Underwriting Officer"></div>
        <div><label>Type</label>
          <select id="roleTypeInput"><option>Fixed</option><option>Tailor-made</option></select>
        </div>
        <div><label>Description</label><input id="roleDescInput" placeholder="What this role does"></div>
      </div>
      <div style="margin-top:10px"><button class="primary" onclick="addRole()">Add role</button></div>
      <hr class="section-divider">
      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Description</th><th></th></tr></thead>
        <tbody>
          <!-- One read-only row per existing role, with a Delete button -->
          ${rows.map((r) => `
            <tr>
              <td>${esc(r.name)}</td>
              <td>${esc(r.type)}</td>
              <td>${esc(r.description)}</td>
              <td class="row-actions"><button class="danger small" onclick="deleteRole(${r.id})">Delete</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

// Runs when "Add role" is clicked.
async function addRole() {
  try {
    // Read whatever was typed/selected in the three form fields and send it
    // to the server to be saved as a new role.
    await api.roles.create({
      name: document.getElementById("roleNameInput").value,
      type: document.getElementById("roleTypeInput").value,
      description: document.getElementById("roleDescInput").value,
    });
    // Redraw the page so the new role shows up in the table.
    router();
  } catch (err) {
    // Show the server's rejection reason (e.g. a required field was left blank).
    alert(err.message);
  }
}

// Runs when a role row's "Delete" button is clicked.
async function deleteRole(id) {
  // Confirm first — deleting a role can't be undone, and warn that any
  // employee rows still using it will be left pointing at a role that no
  // longer exists ("orphaned").
  if (!confirm("Delete this role? (Employee rows referencing it will be orphaned.)")) return;
  try {
    // Tell the server to remove this role's row from the database.
    await api.roles.remove(id);
    // Redraw the page so the deleted role disappears from the table.
    router();
  } catch (err) {
    alert(err.message);
  }
}
