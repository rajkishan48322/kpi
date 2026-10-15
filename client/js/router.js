"use strict";

const ROUTES = [
  { hash: "#/home", label: "Home", group: null, render: renderHome },
  { hash: "#/employees", label: "Employees", group: "Setup",
    description: "Search, view, and manage employee role + KPA weightage records.", render: renderEmployees },
  { hash: "#/employees/add", label: "Add Employee", group: "Setup",
    description: "Add a new employee row with role, KPA, and weightage.", render: renderEmployeeAdd },
  { hash: "#/departments", label: "Departments", group: "Setup",
    description: "Maintain the controlled list of departments.", render: renderDepartments },
  { hash: "#/roles", label: "Roles", group: "Setup",
    description: "Maintain job types such as Marketing Officer or Claims Officer.", render: renderRoles },
  { hash: "#/kpas", label: "KPAs", group: "Setup",
    description: "Define KPI parameters and their marking-scale bands.", render: renderKpas },
  { hash: "#/targets", label: "Target Fixation", group: "Operations",
    description: "Fix monthly targets — creates the Work Allocation Order immediately.", render: renderTargets },
  { hash: "#/workbench-entry", label: "Workbench: Actual Entry", group: "Operations",
    description: "Employees enter actual performance values against their targets.", render: renderWorkbenchEntry },
  { hash: "#/workbench-review", label: "Workbench: Review & Mark", group: "Operations",
    description: "Accepting Authority reviews entries and assigns the final mark.", render: renderWorkbenchReview },
  { hash: "#/dashboard", label: "KPI Score Dashboard", group: "Reporting",
    description: "View the computed, weighted KPI score for any employee and period.", render: renderDashboard },
];

function buildNav() {
  const nav = document.getElementById("navTabs");
  let html = "";
  let lastGroup = null;
  ROUTES.forEach((r) => {
    if (r.group !== lastGroup) {
      html += `<div class="nav-group-label">${esc(r.group)}</div>`;
      lastGroup = r.group;
    }
    html += `<a href="${r.hash}" data-hash="${r.hash}"><span class="dot"></span>${esc(r.label)}</a>`;
  });
  nav.innerHTML = html;
}

async function router() {
  const hash = window.location.hash || ROUTES[0].hash;
  const route = ROUTES.find((r) => r.hash === hash) || ROUTES[0];
  document.querySelectorAll("nav.side-nav a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-hash") === route.hash);
  });
  document.getElementById("crumbTitle").textContent = route.label;
  document.querySelector(".shell").classList.toggle("no-sidebar", route.hash === "#/home");

  const app = document.getElementById("app");
  app.innerHTML = '<div class="loading-state">Loading…</div>';
  try {
    await route.render(app);
  } catch (err) {
    app.innerHTML = `<div class="card"><p class="error-banner">${esc(err.message || "Failed to load this screen.")}</p></div>`;
  }
}

window.addEventListener("hashchange", router);
