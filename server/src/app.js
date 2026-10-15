"use strict";

// "express" is the toolkit this server uses to receive and respond to web
// requests. The next three are small add-ons: "cors" controls which other
// websites are allowed to call this server, "helmet" adds some standard
// security headers to every response, and "morgan" prints a log line for
// every request that comes in (handy for seeing what's happening).
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

// errorHandler turns a thrown error into a proper error reply to the browser (see errors.js).
const { errorHandler } = require("./errors");
// Each of these brings in one subject's set of handlers (list/add/edit/delete, etc.)
// from its own file in the routes/ folder.
const departmentsRouter = require("./routes/departments");
const rolesRouter = require("./routes/roles");
const kpasRouter = require("./routes/kpas");
const employeesRouter = require("./routes/employees");
const targetsRouter = require("./routes/targets");
const workAllocationOrdersRouter = require("./routes/workAllocationOrders");
const dashboardRouter = require("./routes/dashboard");

// This file builds the server — the program that sits and waits for requests
// arriving from the browser (sent by client/js/api.js) and decides what to do
// with each one. Near the bottom of this function, each "app.use('/api/...')"
// line says: "any request whose web address starts with this, hand it off to
// that routes file to deal with." For example, a request to /api/departments
// is handed to server/src/routes/departments.js, which is the piece of code
// that actually talks to the database.
function createApp() {
  // Create the actual server object everything else below configures.
  const app = express();

  // Stop advertising "this server runs Express" in every response — a small security habit.
  app.disable("x-powered-by");
  // Add a standard set of protective response headers (helmet's defaults).
  app.use(helmet({ contentSecurityPolicy: false }));
  // Print one log line per incoming request — a shorter format in production, a more detailed one otherwise.
  app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
  // Automatically read incoming JSON request bodies (what the browser sends when saving/editing something).
  app.use(express.json());

  // Read the comma-separated list of allowed origins from the environment
  // settings (.env), turning "a.com, b.com" into a clean list ["a.com", "b.com"].
  const corsOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  // Only turn on cross-origin permission checks if at least one origin was configured.
  if (corsOrigins.length) {
    app.use(cors({ origin: corsOrigins }));
  }

  // A simple "are you alive?" address — replies instantly with no database involved.
  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // Wire up each subject's address prefix to its routes file.
  app.use("/api/departments", departmentsRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/kpas", kpasRouter);
  app.use("/api/employees", employeesRouter);
  app.use("/api/targets", targetsRouter);
  app.use("/api/work-allocation-orders", workAllocationOrdersRouter);
  app.use("/api/dashboard", dashboardRouter);

  // If a request doesn't match any address above, reply with a plain 404 "not found".
  app.use((req, res) => res.status(404).json({ error: "Not found." }));
  // Catch any error thrown anywhere above and turn it into a proper error reply (see errors.js).
  app.use(errorHandler);

  // Hand back the fully set-up server, ready for index.js to start it listening.
  return app;
}

module.exports = { createApp };
