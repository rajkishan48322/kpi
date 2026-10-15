"use strict";

// Same browser -> api.js -> server -> database pattern as every other screen
// (see client/js/screens/departments.js). This screen and workbenchReview.js
// are the two halves of one journey a "Work Allocation Order" row travels
// through: Pending Entry (nobody has entered a result yet) -> this screen
// lets the employee type their actual number, which flips it to Submitted ->
// workbenchReview.js lets a manager either Accept it (typing in the final
// mark themselves — never calculated automatically) or Reject it, which
// sends it back here to be re-entered.

async function renderWorkbenchEntry(app) {
  // Ask the server only for orders that are either brand new (Pending Entry)
  // or were sent back by a manager (Rejected) — i.e. the ones waiting on the employee.
  const rows = await api.wao.list(["Pending Entry", "Rejected"]);
  app.innerHTML = `
    <div class="card">
      <h2 class="screen-title">Workbench — Actual Entry</h2>
      <p class="screen-desc">The employee's own view: enter your actual performance value for each open Work Allocation Order.</p>
      <!-- If there's nothing waiting, say so; otherwise list one row per order
           with a box to type the actual figure into and a Submit button -->
      ${rows.length === 0 ? `<p class="muted">Nothing waiting on employee entry right now.</p>` : `
      <table>
        <thead><tr><th>Employee</th><th>KPA</th><th>Period</th><th>Target</th><th>Status</th><th>Actual value</th><th></th></tr></thead>
        <tbody>
          ${rows.map((w) => `
            <tr>
              <td>${esc(w.empCode)} — ${esc(w.employeeName)}</td>
              <td>${esc(w.kpaName)}</td>
              <td>${esc(w.period)}</td>
              <td>${w.targetValue}</td>
              <td>${statusBadge(w.status)}</td>
              <td><input id="actualInput_${w.id}" type="number" step="any" value="${w.actualValue === null ? "" : w.actualValue}"></td>
              <td><button class="primary small" onclick="submitActual(${w.id})">Submit</button></td>
            </tr>`).join("")}
        </tbody>
      </table>`}
    </div>`;
}

// Runs when an order's "Submit" button is clicked.
async function submitActual(waoId) {
  // Read the typed value from that specific order's input box.
  const val = document.getElementById("actualInput_" + waoId).value;
  // Stop here with a message if it's empty or not a real number.
  if (val === "" || Number.isNaN(parseFloat(val))) return alert("Enter a numeric actual value.");
  try {
    // Save the actual value — this flips the order's status to "Submitted"
    // and clears out any previous mark on the server, so it's ready for a
    // fresh review.
    await api.wao.submit(waoId, val);
    // Redraw so this order drops off the list (it's no longer Pending/Rejected).
    router();
  } catch (err) {
    alert(err.message);
  }
}
