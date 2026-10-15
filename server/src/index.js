"use strict";

require("dotenv").config();

const { createApp } = require("./app");
const { pool } = require("./db");

const PORT = process.env.PORT || 5010;

async function main() {
  // Fail fast on startup if the database is unreachable or misconfigured,
  // rather than surfacing that as a confusing error on the first request.
  await pool.query("SELECT 1");

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`KPI Workbench API listening on port ${PORT}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Failed to start KPI Workbench API:", err);
  process.exit(1);
});
