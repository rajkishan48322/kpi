"use strict";

const express = require("express");
const { pool } = require("../db");
const { asyncHandler, ApiError } = require("../errors");
const {
  requireString,
  optionalString,
  requireNumber,
  requireId,
} = require("../validate");

// Same request -> database -> response pattern as server/src/routes/departments.js
// (see that file for the full plain-language walkthrough). The one thing to
// know that's special here: the database itself (not this code) refuses to
// save an employee row if that person's rows, added up across every role and
// metric, don't total exactly 100%. That rule lives in schema.sql as a
// "trigger" — an automatic check the database runs on every save.
const router = express.Router();

// A reusable chunk of SQL: get one employee row's own columns, plus the
// readable names that go with its department/role/KPA ids (so the browser
// never has to look those up separately). AS "camelCase" renames each
// database column to match what the JavaScript code expects.
const EMPLOYEE_SELECT = `
  SELECT
    e.id, e.emp_code AS "empCode", e.name,
    e.department_id AS "departmentId", d.name AS "departmentName",
    e.office_code AS "officeCode",
    e.role_id AS "roleId", r.name AS "roleName",
    e.kpa_id AS "kpaId", k.code AS "kpaCode", k.name AS "kpaName", k.unit AS "kpaUnit",
    e.weightage_pct AS "weightagePct",
    e.start_date AS "startDate", e.end_date AS "endDate"
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  JOIN roles r ON r.id = e.role_id
  JOIN kpas k ON k.id = e.kpa_id
`;

// GET /api/employees — every person+role+metric row, in order by employee code.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`${EMPLOYEE_SELECT} ORDER BY e.emp_code, e.id`);
    res.json(rows);
  })
);

// POST /api/employees — save a brand-new row (either a new person's first row,
// or an extra role/metric row for someone who already exists).
router.post(
  "/",
  asyncHandler(async (req, res) => {
    // Check every field the browser sent is present and the right shape.
    const empCode = requireString(req.body.empCode, "Employee Code");
    const name = requireString(req.body.name, "Name");
    // Department is optional — only validate it if one was actually chosen.
    const departmentId = req.body.departmentId ? requireId(req.body.departmentId, "Department") : null;
    const officeCode = optionalString(req.body.officeCode);
    const roleId = requireId(req.body.roleId, "Role");
    const kpaId = requireId(req.body.kpaId, "KPA");
    const weightagePct = requireNumber(req.body.weightagePct, "Weightage %");
    const startDate = requireString(req.body.startDate, "Start date");

    // Insert the new row. If this pushes that person's total weightage away
    // from exactly 100%, the database itself rejects this and an error is
    // thrown here instead of a row ever being saved.
    const { rows } = await pool.query(
      `INSERT INTO employees (emp_code, name, department_id, office_code, role_id, kpa_id, weightage_pct, start_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [empCode, name, departmentId, officeCode, roleId, kpaId, weightagePct, startDate]
    );

    // Re-fetch the full row (with department/role/KPA names attached) to send back.
    const { rows: full } = await pool.query(`${EMPLOYEE_SELECT} WHERE e.id = $1`, [rows[0].id]);
    res.status(201).json(full[0]);
  })
);

// PUT /api/employees/:id — edit one row's KPA and/or weightage.
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "Employee row id");
    const kpaId = requireId(req.body.kpaId, "KPA");
    const weightagePct = requireNumber(req.body.weightagePct, "Weightage %");

    // Update just those two fields on this one row. Again, if the new total
    // for this person doesn't add up to 100%, the database refuses the save.
    const { rowCount } = await pool.query(
      "UPDATE employees SET kpa_id = $1, weightage_pct = $2 WHERE id = $3",
      [kpaId, weightagePct, id]
    );
    if (!rowCount) throw new ApiError(404, "Employee row not found.");

    const { rows: full } = await pool.query(`${EMPLOYEE_SELECT} WHERE e.id = $1`, [id]);
    res.json(full[0]);
  })
);

// DELETE /api/employees/:id — remove one row.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "Employee row id");
    const { rowCount } = await pool.query("DELETE FROM employees WHERE id = $1", [id]);
    if (!rowCount) throw new ApiError(404, "Employee row not found.");
    res.status(204).end();
  })
);

module.exports = router;
