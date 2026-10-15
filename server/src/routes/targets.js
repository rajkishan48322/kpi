"use strict";

const express = require("express");
const { pool } = require("../db");
const { asyncHandler } = require("../errors");
const { requireString, requireNumber, requireId, requirePeriod } = require("../validate");

const router = express.Router();

// A reusable chunk of SQL: get one target's own columns, plus the person/role/
// metric names it belongs to, plus (if one has already been auto-created) the
// id and status of its matching Work Allocation Order.
const TARGET_SELECT = `
  SELECT
    t.id, t.employee_id AS "employeeId", t.period, t.target_value AS "targetValue",
    t.set_by AS "setBy", t.created_at AS "createdAt",
    e.emp_code AS "empCode", e.name AS "employeeName",
    r.name AS "roleName", k.name AS "kpaName", k.unit AS "kpaUnit",
    w.id AS "waoId", w.status AS "waoStatus"
  FROM targets t
  JOIN employees e ON e.id = t.employee_id
  JOIN roles r ON r.id = e.role_id
  JOIN kpas k ON k.id = e.kpa_id
  LEFT JOIN work_allocation_orders w ON w.employee_id = t.employee_id AND w.period = t.period
`;

// GET /api/targets — every target ever set, newest first.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`${TARGET_SELECT} ORDER BY t.created_at DESC`);
    res.json(rows);
  })
);

// In plain words: this code only saves the target itself. It does NOT also
// create the Work Allocation Order row you'll see appear right after —
// that happens automatically inside the database (a "trigger" named
// trg_target_creates_wao in schema.sql fires the moment this INSERT happens).
// So the work order isn't missing from this code by accident — the database
// is doing that part on its own.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    // Check every field the browser sent: which employee row, which month
    // (in YYYY-MM format), the target figure, and who set it.
    const employeeId = requireId(req.body.employeeId, "Employee row");
    const period = requirePeriod(req.body.period);
    const targetValue = requireNumber(req.body.targetValue, "Target value");
    const setBy = requireString(req.body.setBy, "Set by");

    // Save the target. This single INSERT is what triggers the database to
    // automatically create the matching Work Allocation Order behind the scenes.
    const { rows } = await pool.query(
      `INSERT INTO targets (employee_id, period, target_value, set_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [employeeId, period, targetValue, setBy]
    );

    // Re-fetch the full target row — by now its auto-created work order
    // already exists, so this also picks up that order's id and status.
    const { rows: full } = await pool.query(`${TARGET_SELECT} WHERE t.id = $1`, [rows[0].id]);
    res.status(201).json(full[0]);
  })
);

module.exports = router;
