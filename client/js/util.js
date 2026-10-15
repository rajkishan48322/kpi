"use strict";

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function statusBadge(status) {
  const cls = { "Pending Entry": "pending", Submitted: "submitted", Accepted: "accepted", Rejected: "rejected" }[status] || "pending";
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

/** Reference-only marking scale evaluator — mirrors fn_suggested_mark() in schema.sql. */
function suggestedMarkFromBands(direction, bands, targetValue, actualValue) {
  if (targetValue === null || targetValue === undefined || actualValue === null || actualValue === undefined || Number.isNaN(actualValue)) {
    return null;
  }
  const delta = direction === "higher-better" ? actualValue - targetValue : targetValue - actualValue;
  for (const band of bands) {
    const minOk = band.minDelta === null || band.minDelta === undefined || delta >= band.minDelta;
    const maxOk = band.maxDelta === null || band.maxDelta === undefined || delta <= band.maxDelta;
    if (minOk && maxOk) return band.mark;
  }
  return null;
}
