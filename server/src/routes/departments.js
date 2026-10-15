"use strict";

// "express" lets us define handlers per web address/method.
const express = require("express");
// `pool` is the open connection to the database (see server/src/db.js).
const { pool } = require("../db");
// asyncHandler lets us write these handlers with plain try/catch-free async
// code; ApiError lets us say "stop here and send back this exact error".
const { asyncHandler, ApiError } = require("../errors");
// Small helper functions that check the incoming data is actually usable
// before we try to save it (see server/src/validate.js).
const { requireString, requireId } = require("../validate");

// This is the simplest example in the app of a full round trip. When the
// browser calls api.departments.list()/.create()/.update()/.remove() (see
// client/js/api.js), the request lands on one of the handlers below. Each
// handler talks directly to the PostgreSQL database using `pool.query(...)` —
// that's literally sending a SQL command (a database instruction, written in
// its own language) over the connection set up in server/src/db.js, and
// getting the matching rows/result back. The handler then sends that back to
// the browser as the reply. Every other routes file in this folder works the
// same way, just with more fields and extra rules layered on.
const router = express.Router();

// The browser asks for this (GET /api/departments) every time it needs the
// full list — e.g. to fill a dropdown or show the Departments table.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    // Ask the database for every department's id and name, alphabetically.
    const { rows } = await pool.query("SELECT id, name FROM departments ORDER BY name");
    // Send that list back to the browser as the reply.
    res.json(rows);
  })
);

// The browser sends this (POST /api/departments) when "Add" is clicked on the
// Departments screen. First the name is checked for being non-empty, then a
// new row is inserted into the `departments` table in the database, and the
// freshly-saved row (now with its database-assigned id) is sent back so the
// screen can display it immediately.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    // Check the name sent by the browser isn't blank — stop with an error if it is.
    const name = requireString(req.body.name, "Department name");
    // Add a new row to the departments table, and ask the database to hand
    // back the id it just assigned along with the name.
    const { rows } = await pool.query(
      "INSERT INTO departments (name) VALUES ($1) RETURNING id, name",
      [name]
    );
    // Reply with status 201 ("created") and the newly-saved row.
    res.status(201).json(rows[0]);
  })
);

// The browser sends this (PUT /api/departments/:id) when a department's name is edited in place.
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    // Check the id in the web address is a real number.
    const id = requireId(req.params.id, "Department id");
    // Check the new name isn't blank.
    const name = requireString(req.body.name, "Department name");
    // Update that one row's name in the database.
    const { rows } = await pool.query(
      "UPDATE departments SET name = $1 WHERE id = $2 RETURNING id, name",
      [name, id]
    );
    // If no row had that id, nothing was updated — tell the browser it wasn't found.
    if (!rows[0]) throw new ApiError(404, "Department not found.");
    // Otherwise reply with the saved row.
    res.json(rows[0]);
  })
);

// The browser sends this (DELETE /api/departments/:id) when "Delete" is clicked.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "Department id");
    // Remove that row from the database; rowCount tells us whether anything actually matched.
    const { rowCount } = await pool.query("DELETE FROM departments WHERE id = $1", [id]);
    if (!rowCount) throw new ApiError(404, "Department not found.");
    // Reply with status 204 ("done, nothing more to say") and no body.
    res.status(204).end();
  })
);

module.exports = router;
