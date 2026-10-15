"use strict";

// The manager's half of the Submitted -> Accepted/Rejected journey described
// at the top of workbenchEntry.js. The band table shown here is only a
// reference chart (it suggests a mark based on how far the actual value was
// from the target) — the manager always has to type the real mark in by
// hand, the database never fills it in automatically.

async function renderWorkbenchReview(app) {
  // Get just the orders awaiting review (status "Submitted").
  const rows = await api.wao.list(["Submitted"]);
  // For each one, fetch its full detail — including its scoring bands and the
  // reference-only suggested mark — all at the same time.
  const details = await Promise.all(rows.map((w) => api.wao.get(w.id)));

  app.innerHTML = `
    <div class="card">
      <h2 class="screen-title">Workbench — Review &amp; Mark</h2>
      <p class="screen-desc">Accepting Authority's view. The band table is shown as a reference only — the mark is always a manual entry.</p>
      <!-- If nothing is waiting, say so; otherwise draw one review card per order -->
      ${details.length === 0 ? `<p class="muted">Nothing waiting for review right now.</p>` : details.map((w) => renderReviewRow(w)).join("")}
    </div>`;
}

// Builds one order's review card: who/what it's for, the reference scoring
// chart, the suggested mark, and the boxes to Accept or Reject it.
function renderReviewRow(w) {
  return `
    <div class="card" style="background:var(--slate-25)">
      <b>${esc(w.empCode)} — ${esc(w.employeeName)}</b> — ${esc(w.kpaName)}
      <span class="muted">(${esc(w.period)}, target ${w.targetValue}, actual ${w.actualValue})</span>
      <!-- The scoring chart for this metric, shown purely for reference -->
      <table class="band-ref-table" style="margin-top:8px">
        <thead><tr><th>Label</th><th>Min &Delta;</th><th>Max &Delta;</th><th>Mark</th></tr></thead>
        <tbody>
          ${w.bands.map((b) => `<tr><td>${esc(b.label)}</td><td>${b.minDelta === null ? "(open)" : b.minDelta}</td><td>${b.maxDelta === null ? "(open)" : b.maxDelta}</td><td>${b.mark}</td></tr>`).join("")}
        </tbody>
      </table>
      <p class="muted">Reference suggests: <b>${w.suggestedMark === null ? "no matching band" : w.suggestedMark}</b> — you are not required to use this.</p>
      <!-- The Mark box starts pre-filled with the suggestion, but it's fully
           editable — nothing stops the manager from typing a different number -->
      <div class="inline-form-row">
        <div><label>Mark (manual entry)</label><input id="markInput_${w.id}" type="number" step="any" value="${w.suggestedMark === null ? "" : w.suggestedMark}"></div>
        <div><label>Accepting authority</label><input id="acceptByInput_${w.id}" placeholder="e.g. RO Claims Head"></div>
        <div style="flex:0"><button class="primary" onclick="acceptWao(${w.id})">Accept</button></div>
        <div style="flex:0"><button class="danger" onclick="rejectWao(${w.id})">Reject</button></div>
      </div>
    </div>`;
}

// Runs when an order's "Accept" button is clicked.
async function acceptWao(waoId) {
  // Read the mark and the name of whoever is accepting it.
  const mark = document.getElementById("markInput_" + waoId).value;
  const acceptedBy = document.getElementById("acceptByInput_" + waoId).value.trim();
  // Stop here with a message if either is missing/invalid.
  if (mark === "" || Number.isNaN(parseFloat(mark)) || !acceptedBy) {
    return alert("Mark and Accepting Authority name are required.");
  }
  try {
    // Save the final mark and mark this order as Accepted.
    await api.wao.accept(waoId, mark, acceptedBy);
    // Redraw so this order disappears from the review list (it's no longer "Submitted").
    router();
  } catch (err) {
    alert(err.message);
  }
}

// Runs when an order's "Reject" button is clicked — sends it back for the
// employee to correct and resubmit.
async function rejectWao(waoId) {
  try {
    await api.wao.reject(waoId);
    router();
  } catch (err) {
    alert(err.message);
  }
}
