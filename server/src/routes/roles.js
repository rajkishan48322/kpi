"use strict";

const express = require("express");
const { pool } = require("../db");
const { asyncHandler, ApiError } = require("../errors");
const { requireString, optionalString, requireOneOf, requireId } = require("../validate");

// Same request -> database -> response pattern as departments.js.
const router = express.Router();

// The only two role types allowed — anything else gets rejected.
const ROLE_TYPES = ["Fixed", "Tailor-made"];

// GET /api/roles — send back the full list of job-role types.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT id, name, type, description FROM roles ORDER BY name"
    );
    res.json(rows);
  })
);

// POST /api/roles — save a brand-new role.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    // Name must be present; type must be exactly "Fixed" or "Tailor-made";
    // description is allowed to be left blank.
    const name = requireString(req.body.name, "Role name");
    const type = requireOneOf(req.body.type, ROLE_TYPES, "Role type");
    const description = optionalString(req.body.description);
    // Insert the new row and get back the saved version (with its new id).
    const { rows } = await pool.query(
      "INSERT INTO roles (name, type, description) VALUES ($1, $2, $3) RETURNING id, name, type, description",
      [name, type, description]
    );
    res.status(201).json(rows[0]);
  })
);

// PUT /api/roles/:id — edit an existing role.
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "Role id");
    const name = requireString(req.body.name, "Role name");
    const type = requireOneOf(req.body.type, ROLE_TYPES, "Role type");
    const description = optionalString(req.body.description);
    // Update that one row with the new values.
    const { rows } = await pool.query(
      "UPDATE roles SET name = $1, type = $2, description = $3 WHERE id = $4 RETURNING id, name, type, description",
      [name, type, description, id]
    );
    if (!rows[0]) throw new ApiError(404, "Role not found.");
    res.json(rows[0]);
  })
);

// DELETE /api/roles/:id — remove a role.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "Role id");
    const { rowCount } = await pool.query("DELETE FROM roles WHERE id = $1", [id]);
    if (!rowCount) throw new ApiError(404, "Role not found.");
    res.status(204).end();
  })
);

module.exports = router;
