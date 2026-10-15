"use strict";

const express = require("express");
const { pool } = require("../db");
const { asyncHandler } = require("../errors");
const { requireString, requirePeriod } = require("../validate");

// Same request -> database -> response pattern as departments.js. Instead of
// a plain SELECT, this calls two ready-made calculator functions that live
// inside the database itself (fn_kpi_score_lines / fn_kpi_score_final, defined
// in schema.sql) — they do the "mark x weight, added up" maths described in
// dashboard.js, so this file just asks for the already-computed answer.
const router = express.Router();

// GET /api/dashboard/:empCode/:period — the score breakdown and final total
// for one person for one month.
router.get(
  "/:empCode/:period",
  asyncHandler(async (req, res) => {
    // Check the employee code was given, and the period is in YYYY-MM format.
    const empCode = requireString(req.params.empCode, "Employee Code");
    const period = requirePeriod(req.params.period);

    // Ask the database for the per-metric breakdown and the single final
    // total at the same time — both come from calculator functions defined
    // in schema.sql, not from maths done here.
    const [{ rows: lines }, { rows: final }] = await Promise.all([
      pool.query(
        `SELECT role_name AS "roleName", kpa_name AS "kpaName", weightage_pct AS "weightagePct",
                actual_value AS "actualValue", mark, weighted_score AS "weightedScore", wao_status AS "waoStatus"
         FROM fn_kpi_score_lines($1, $2)`,
        [empCode, period]
      ),
      pool.query(
        `SELECT final_score AS "finalScore", kpas_scored AS "kpasScored", kpas_total AS "kpasTotal"
         FROM fn_kpi_score_final($1, $2)`,
        [empCode, period]
      ),
    ]);

    // Combine the per-metric rows and the final totals into one reply object.
    res.json({ lines, ...final[0] });
  })
);

module.exports = router;
