"use strict";

const HOME_ACCENTS = ["accent-a", "accent-b", "accent-c", "accent-d", "accent-e", "accent-f"];

function renderHome(app) {
  const tiles = ROUTES.filter((r) => r.hash !== "#/home");

  app.innerHTML = `
    <div class="home-banner">
      <h2 class="home-banner-title">KPI Workbench</h2>
      <p class="home-banner-sub">Select a module to get started</p>
    </div>
    <div class="home-grid">
      ${tiles.map((r, i) => {
        const accent = HOME_ACCENTS[i % HOME_ACCENTS.length];
        return `
          <a class="home-card ${accent}" href="${r.hash}">
            <div class="home-card-body">
              <div class="home-card-title">${esc(r.label)}</div>
              <p class="home-card-desc">${esc(r.description || "")}</p>
            </div>
            <div class="home-card-foot">Open <span class="home-card-arrow">&rarr;</span></div>
          </a>`;
      }).join("")}
    </div>
  `;
}
