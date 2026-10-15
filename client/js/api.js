"use strict";

// ----------------------------------------------------------------------------
// This file is the ONLY place in the whole frontend that is allowed to talk to
// the server. Think of it as a messenger: a screen (e.g. departments.js) hands
// this file a request ("please save this new department"), this file carries
// that request across the network to the server, waits for the server's reply,
// and hands that reply back. No screen file ever contacts the server directly.
// ----------------------------------------------------------------------------

// The web address every request gets sent to, before the specific path
// (like "/departments") is added on the end.
const API_BASE = "/kpi/api";

// apiRequest() does the actual network trip. `fetch` is a built-in browser
// feature for sending a request to a web address and getting a response back —
// the same mechanism your browser uses to load a page, except here it's
// sending/receiving raw data (JSON) instead of a full webpage.
async function apiRequest(path, options = {}) {
  // Send the request to the server and wait here until it replies.
  // "headers" tells the server the data being sent is in JSON format;
  // "...options" fills in the rest (which method — GET/POST/PUT/DELETE —
  // and what data, if any, is being sent along with the request).
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  // Status 204 means "done, successfully, and there's nothing to send back"
  // (used for deletes) — so there's no reply body to read.
  if (res.status === 204) return null;

  // Try to read the server's reply as JSON (structured data).
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    // If the reply wasn't valid JSON (e.g. the server crashed and sent plain
    // text), just treat it as having no body rather than erroring out here.
    body = null;
  }

  // If the server reported an error (anything other than a 200-range status),
  // raise it as a JavaScript error, using the server's message if it sent one.
  if (!res.ok) {
    throw new Error((body && body.error) || `Request failed (${res.status})`);
  }
  // Otherwise, hand back whatever data the server sent.
  return body;
}

// The `api` object below groups every kind of request this app can make, by
// subject (departments, roles, employees, ...). Each function here is a thin
// wrapper: it just fills in which web address to call and what data to send.
// e.g. api.departments.create({name: "Underwriting"}) sends that name to the
// server's /api/departments address, using an HTTP "POST" (the standard way
// of saying "here is new data to save", as opposed to "GET" which means
// "just send me data, don't change anything").
const api = {
  departments: {
    list: () => apiRequest("/departments"), // get every department
    create: (data) => apiRequest("/departments", { method: "POST", body: JSON.stringify(data) }), // save a new one
    update: (id, data) => apiRequest(`/departments/${id}`, { method: "PUT", body: JSON.stringify(data) }), // rename an existing one
    remove: (id) => apiRequest(`/departments/${id}`, { method: "DELETE" }), // delete one
  },
  roles: {
    list: () => apiRequest("/roles"), // get every job-role type
    create: (data) => apiRequest("/roles", { method: "POST", body: JSON.stringify(data) }), // save a new one
    update: (id, data) => apiRequest(`/roles/${id}`, { method: "PUT", body: JSON.stringify(data) }), // edit an existing one
    remove: (id) => apiRequest(`/roles/${id}`, { method: "DELETE" }), // delete one
  },
  kpas: {
    list: () => apiRequest("/kpas"), // get every performance metric, including its scoring bands
    create: (data) => apiRequest("/kpas", { method: "POST", body: JSON.stringify(data) }), // save a new metric
    update: (id, data) => apiRequest(`/kpas/${id}`, { method: "PUT", body: JSON.stringify(data) }), // edit an existing one
    remove: (id) => apiRequest(`/kpas/${id}`, { method: "DELETE" }), // delete one
    // Overwrite this metric's whole scoring chart in one go (replaces every band at once).
    replaceBands: (id, bands) => apiRequest(`/kpas/${id}/bands`, { method: "PUT", body: JSON.stringify({ bands }) }),
    // Ask the server what mark its scoring chart would suggest for a given target/actual pair
    // (used for a reference preview only — never saved automatically).
    suggestedMark: (id, target, actual) =>
      apiRequest(`/kpas/${id}/suggested-mark?target=${encodeURIComponent(target)}&actual=${encodeURIComponent(actual)}`),
  },
  employees: {
    list: () => apiRequest("/employees"), // get every person+role+metric row
    create: (data) => apiRequest("/employees", { method: "POST", body: JSON.stringify(data) }), // save a new row
    update: (id, data) => apiRequest(`/employees/${id}`, { method: "PUT", body: JSON.stringify(data) }), // edit an existing row
    remove: (id) => apiRequest(`/employees/${id}`, { method: "DELETE" }), // delete a row
  },
  targets: {
    list: () => apiRequest("/targets"), // get every target ever set
    create: (data) => apiRequest("/targets", { method: "POST", body: JSON.stringify(data) }), // set a new target (this also auto-creates its work order — see routes/targets.js)
  },
  wao: {
    // "wao" = Work Allocation Order. Get only the orders whose status matches
    // one of the given list (e.g. only "Submitted" ones, for the review screen).
    list: (statuses) => apiRequest(`/work-allocation-orders?status=${statuses.map(encodeURIComponent).join(",")}`),
    get: (id) => apiRequest(`/work-allocation-orders/${id}`), // get one order's full detail, including its scoring chart
    // Employee action: record their actual performance value for this order.
    submit: (id, actualValue) =>
      apiRequest(`/work-allocation-orders/${id}/submit`, { method: "PUT", body: JSON.stringify({ actualValue }) }),
    // Manager action: record the final mark they typed in and who approved it.
    accept: (id, mark, acceptedBy) =>
      apiRequest(`/work-allocation-orders/${id}/accept`, { method: "PUT", body: JSON.stringify({ mark, acceptedBy }) }),
    // Manager action: send it back for the employee to re-enter.
    reject: (id) => apiRequest(`/work-allocation-orders/${id}/reject`, { method: "PUT" }),
  },
  dashboard: {
    // Get the computed, weighted final score for one person for one month.
    get: (empCode, period) => apiRequest(`/dashboard/${encodeURIComponent(empCode)}/${encodeURIComponent(period)}`),
  },
};
