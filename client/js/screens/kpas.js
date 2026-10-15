"use strict";

// Same browser -> api.js -> server -> database pattern as every other screen
// (see client/js/screens/departments.js). This screen also manages each
// KPA's "bands" — a reference scoring chart ("if the actual value is this
// close to the target, mark X is suggested"). The "Live preview" box further
// down is calculated right here in the browser (see updateBandPreview and
// suggestedMarkFromBands in util.js) purely so it updates instantly as you
// type, without waiting on a trip to the server — but it's only ever a
// suggestion. The real mark a manager assigns always has to be typed by hand
// on the Workbench Review screen; nothing here saves a mark automatically.

// Keeps the last list of KPAs fetched from the server, so other functions on
// this page (like the band editor) can look one up without asking the server again.
let _kpasCache = [];
// Holds the bands currently being edited, or null when no editor is open.
// Shape: { kpaId, bands: [{ id?, label, minDelta, maxDelta, mark }, ...] }
let _kpaBandDraft = null;

// Finds one KPA's details in the cached list above, by its id.
function kpaByIdFromCache(id) {
  return _kpasCache.find((k) => k.id === id) || null;
}

async function renderKpas(app) {
  // Fetch the current list of KPAs (each one already includes its bands) and
  // remember it in the cache for the rest of this page's functions to use.
  _kpasCache = await api.kpas.list();
  const rows = _kpasCache;

  // Draw: a table of existing KPAs, a form to add a new one, and — only if
  // a band editor is currently open — the band editor itself underneath.
  app.innerHTML = `
    <div class="card">
      <h2 class="screen-title">KPAs / Parameters</h2>
      <p class="screen-desc">Each KPA carries its own dynamic marking-scale bands, used only as a reference — never auto-applied to a mark.</p>
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Unit</th><th>Direction</th><th>Source</th><th>Bands</th><th></th></tr></thead>
        <tbody>
          <!-- One row per KPA, with the count of bands it has and buttons to edit those bands or delete the KPA -->
          ${rows.map((k) => `
            <tr>
              <td>${esc(k.code)}</td>
              <td>${esc(k.name)}</td>
              <td>${esc(k.unit)}</td>
              <td>${esc(k.direction)}</td>
              <td>${esc(k.source)}</td>
              <td>${k.bands.length}</td>
              <td class="row-actions">
                <button class="small" onclick="editKpaBands(${k.id})">Edit bands</button>
                <button class="danger small" onclick="deleteKpa(${k.id})">Delete</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h2 class="screen-title">Add a new KPA</h2>
      <!-- Form for a brand-new KPA: a unique code, display name, unit of measure,
           whether higher or lower values are better, and where its actual figures come from -->
      <div class="form-grid">
        <div><label>KPI Code (unique)</label><input id="kpaCodeInput" placeholder="e.g. KPI-003"></div>
        <div><label>Name</label><input id="kpaNameInput" placeholder="e.g. New Policy Count"></div>
        <div><label>Unit</label><input id="kpaUnitInput" placeholder="%, days, count..."></div>
        <div><label>Direction</label>
          <select id="kpaDirInput"><option value="higher-better">higher-better</option><option value="lower-better">lower-better</option></select>
        </div>
        <div><label>Source</label>
          <select id="kpaSourceInput"><option>GC</option><option>WB</option><option>Manual</option></select>
        </div>
      </div>
      <label>Definition / Formula</label><input id="kpaDefInput" placeholder="How is this measured?">
      <div style="margin-top:10px"><button class="primary" onclick="addKpa()">Add KPA (with a starter 3-band scale you can edit after)</button></div>
    </div>
    <!-- If a band editor is currently open (_kpaBandDraft is set), draw it below; otherwise draw nothing extra -->
    ${_kpaBandDraft ? renderBandEditor() : ""}
  `;
  // If the band editor is open, (re)calculate its live preview box now that
  // the page has just been redrawn.
  if (_kpaBandDraft) updateBandPreview();
}

// A starter 3-row scoring chart handed to every brand-new KPA, so there's
// something sensible to edit rather than an empty chart.
function defaultBands() {
  return [
    { label: "At Target", minDelta: 0, maxDelta: 0, mark: 90 }, // exactly on target
    { label: "Slightly below", minDelta: -1, maxDelta: -0.01, mark: 80 }, // a little short of target
    { label: "Slightly above", minDelta: 0.01, maxDelta: 1, mark: 95 }, // a little better than target
  ];
}

// Runs when "Add KPA" is clicked.
async function addKpa() {
  try {
    // Read every field from the "Add a new KPA" form and send it to the
    // server to be saved as a new row, then remember the saved KPA (now with
    // its database-assigned id) in `kpa`.
    const kpa = await api.kpas.create({
      code: document.getElementById("kpaCodeInput").value,
      name: document.getElementById("kpaNameInput").value,
      definition: document.getElementById("kpaDefInput").value,
      unit: document.getElementById("kpaUnitInput").value,
      direction: document.getElementById("kpaDirInput").value,
      source: document.getElementById("kpaSourceInput").value,
    });
    // Now give that brand-new KPA the starter 3-band scoring chart.
    await api.kpas.replaceBands(kpa.id, defaultBands());
    // Redraw the page so the new KPA appears in the table.
    router();
  } catch (err) {
    alert(err.message);
  }
}

// Runs when a KPA row's "Delete" button is clicked.
async function deleteKpa(id) {
  // Confirm first, and warn that employees still scored on this KPA will be left pointing at one that no longer exists.
  if (!confirm("Delete this KPA? (Employee rows referencing it will be orphaned.)")) return;
  try {
    await api.kpas.remove(id);
    router();
  } catch (err) {
    alert(err.message);
  }
}

// Runs when "Edit bands" is clicked for a KPA. Opens the band editor below
// the table by filling in _kpaBandDraft with a *copy* of that KPA's current
// bands (so edits can be cancelled without having changed anything yet).
function editKpaBands(kpaId) {
  const kpa = kpaByIdFromCache(kpaId);
  if (!kpa) return; // safety check: do nothing if that KPA can't be found
  // JSON.parse(JSON.stringify(...)) makes a completely separate copy of the
  // bands list, so editing the draft doesn't also change the cached original.
  _kpaBandDraft = { kpaId, bands: JSON.parse(JSON.stringify(kpa.bands)) };
  router(); // redraw the page so the editor now appears
}

// Draws the band editor itself — a table of editable rows, plus the live
// preview box at the bottom. Only called when _kpaBandDraft is set.
function renderBandEditor() {
  const kpa = kpaByIdFromCache(_kpaBandDraft.kpaId);
  const bands = _kpaBandDraft.bands;
  return `
    <div class="card">
      <h2 class="screen-title">Editing bands: ${esc(kpa.name)} (${esc(kpa.direction)})</h2>
      <p class="screen-desc">minDelta/maxDelta are offsets from target in "goodness" terms — positive = better than target. Leave blank for an open-ended floor/ceiling band.</p>
      <table>
        <thead><tr><th>Label</th><th>Min &Delta;</th><th>Max &Delta;</th><th>Mark</th><th></th></tr></thead>
        <tbody>
          <!-- One editable row per band in the draft. Typing into any box
               updates the in-memory draft directly (nothing is saved to the
               server until "Save bands" is clicked). -->
          ${bands.map((b, i) => `
            <tr>
              <td><input value="${esc(b.label)}" onchange="_kpaBandDraft.bands[${i}].label=this.value"></td>
              <td><input type="number" step="any" value="${b.minDelta === null ? "" : b.minDelta}" placeholder="(open)" onchange="_kpaBandDraft.bands[${i}].minDelta=this.value===''?null:parseFloat(this.value)"></td>
              <td><input type="number" step="any" value="${b.maxDelta === null ? "" : b.maxDelta}" placeholder="(open)" onchange="_kpaBandDraft.bands[${i}].maxDelta=this.value===''?null:parseFloat(this.value)"></td>
              <td><input type="number" step="any" value="${b.mark}" onchange="_kpaBandDraft.bands[${i}].mark=parseFloat(this.value)"></td>
              <td><button class="danger small" onclick="removeBandRow(${i})">Remove</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
      <div style="margin-top:10px">
        <button class="small" onclick="addBandRow()">+ Add band row</button>
        <button class="primary" onclick="saveBandDraft()">Save bands</button>
        <button onclick="cancelBandDraft()">Cancel</button>
      </div>
      <hr class="section-divider">
      <b>Live preview</b>
      <!-- Type a sample target/actual pair here to see, instantly, what mark
           this draft scoring chart would suggest — calculated in the browser,
           no server round trip needed. -->
      <div class="inline-form-row" style="margin-top:8px">
        <div><label>Target value</label><input id="bandPreviewTarget" type="number" step="any" value="10" oninput="updateBandPreview()"></div>
        <div><label>Actual value</label><input id="bandPreviewActual" type="number" step="any" value="11" oninput="updateBandPreview()"></div>
        <div><label>Suggested mark</label><input id="bandPreviewResult" disabled></div>
      </div>
    </div>
  `;
}

// Adds one blank new row to the draft and redraws, so it appears in the editor.
function addBandRow() {
  _kpaBandDraft.bands.push({ label: "New band", minDelta: null, maxDelta: null, mark: 0 });
  router();
}
// Removes the row at position `i` from the draft and redraws.
function removeBandRow(i) {
  _kpaBandDraft.bands.splice(i, 1);
  router();
}
// Throws away the draft without saving anything, and redraws (closing the editor).
function cancelBandDraft() {
  _kpaBandDraft = null;
  router();
}
// Runs when "Save bands" is clicked.
async function saveBandDraft() {
  try {
    // Send the whole edited band list to the server, replacing what was there before.
    await api.kpas.replaceBands(_kpaBandDraft.kpaId, _kpaBandDraft.bands);
    // Close the editor now that it's saved, and redraw to show the updated band count.
    _kpaBandDraft = null;
    router();
  } catch (err) {
    alert(err.message);
  }
}
// Recalculates the "Suggested mark" preview box whenever the sample target or
// actual value changes, or whenever a band row is edited.
function updateBandPreview() {
  // Read the two sample numbers typed into the preview boxes.
  const t = parseFloat(document.getElementById("bandPreviewTarget").value);
  const a = parseFloat(document.getElementById("bandPreviewActual").value);
  const kpa = kpaByIdFromCache(_kpaBandDraft.kpaId);
  // Run the same band-matching logic the database uses (see util.js), right
  // here in the browser, against the draft bands (not yet saved).
  const result = suggestedMarkFromBands(kpa.direction, _kpaBandDraft.bands, t, a);
  // Show the result, or a friendly message if no band in the draft matches.
  document.getElementById("bandPreviewResult").value = result === null ? "(no matching band)" : result;
}
