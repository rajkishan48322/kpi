"use strict";

const express = require("express");
const { pool } = require("../db");
const { asyncHandler, ApiError } = require("../errors");
const { requireString, requireNumber, requireId } = require("../validate");

// Same request -> database -> response pattern as departments.js. The order
// (called a "WAO" for short, as in Work Allocation Order) moves through a
// fixed set of stages — see the WAO_STATUSES line right below — and the
// /accept and /reject handlers further down deliberately only work on an
// order that is currently "Submitted". That guard is what stops the same
// order from being accepted twice, or accepted before anyone has actually
// entered a result for it.
const router = express.Router();

// The only statuses an order can be in, in the order they're normally reached.
const WAO_STATUSES = ["Pending Entry", "Submitted", "Accepted", "Rejected"];

// A reusable chunk of SQL: one order's own columns, plus the person's name/code
// and the metric's name/scoring direction it's for.
const WAO_SELECT = `
  SELECT
    w.id, w.employee_id AS "employeeId", w.target_id AS "targetId", w.period,
    w.target_value AS "targetValue", w.weightage_pct AS "weightagePct",
    w.actual_value AS "actualValue", w.submitted_date AS "submittedDate",
    w.mark, w.accepted_by AS "acceptedBy", w.accepted_date AS "acceptedDate", w.status,
    e.emp_code AS "empCode", e.name AS "employeeName",
    k.id AS "kpaId", k.name AS "kpaName", k.direction AS "kpaDirection"
  FROM work_allocation_orders w
  JOIN employees e ON e.id = w.employee_id
  JOIN kpas k ON k.id = e.kpa_id
`;

// GET /api/work-allocation-orders — every order, or only ones in certain
// statuses (used by the Workbench screens to each show just their own slice).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    // The web address's "?status=..." part — may arrive as one string
    // ("Submitted") or several joined with commas ("Submitted,Rejected").
    let statuses = req.query.status;
    if (typeof statuses === "string") statuses = statuses.split(",");

    if (statuses && statuses.length) {
      // Reject the request outright if an unrecognised status was asked for.
      const invalid = statuses.filter((s) => !WAO_STATUSES.includes(s));
      if (invalid.length) {
        throw new ApiError(400, `Unknown status: ${invalid.join(", ")}`);
      }
      // Only fetch orders whose status is one of the ones asked for.
      const { rows } = await pool.query(
        `${WAO_SELECT} WHERE w.status = ANY($1) ORDER BY w.period DESC, e.emp_code`,
        [statuses]
      );
      return res.json(rows);
    }

    // No status filter given — return every order.
    const { rows } = await pool.query(`${WAO_SELECT} ORDER BY w.period DESC, e.emp_code`);
    res.json(rows);
  })
);

// GET /api/work-allocation-orders/:id — one order's full detail, used by the
// manager's review screen.
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "Work Allocation Order id");
    const { rows } = await pool.query(`${WAO_SELECT} WHERE w.id = $1`, [id]);
    if (!rows[0]) throw new ApiError(404, "Work Allocation Order not found.");

    // At the same time, fetch this order's metric's scoring bands and ask
    // the database's own calculator what mark it would suggest.
    const [{ rows: bands }, { rows: suggested }] = await Promise.all([
      pool.query(
        "SELECT id, label, min_delta AS \"minDelta\", max_delta AS \"maxDelta\", mark, sort_order AS \"sortOrder\" FROM kpa_bands WHERE kpa_id = $1 ORDER BY sort_order",
        [rows[0].kpaId]
      ),
      pool.query("SELECT fn_suggested_mark($1, $2, $3) AS mark", [
        rows[0].kpaId,
        rows[0].targetValue,
        rows[0].actualValue,
      ]),
    ]);

    // Combine the order's own fields with its bands and the suggestion into one reply.
    res.json({ ...rows[0], bands, suggestedMark: suggested[0].mark });
  })
);

// Employee's own action: submit an actual value. The DB trigger clears any
// previous mark/acceptance automatically when this happens on a re-submit.
router.put(
  "/:id/submit",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "Work Allocation Order id");
    const actualValue = requireNumber(req.body.actualValue, "Actual value");

    // Save the actual value, stamp today's date as when it was submitted,
    // and move the status to "Submitted" so it shows up for the manager to review.
    const { rows } = await pool.query(
      `UPDATE work_allocation_orders
       SET actual_value = $1, submitted_date = CURRENT_DATE, status = 'Submitted'
       WHERE id = $2 RETURNING id`,
      [actualValue, id]
    );
    if (!rows[0]) throw new ApiError(404, "Work Allocation Order not found.");

    const { rows: full } = await pool.query(`${WAO_SELECT} WHERE w.id = $1`, [id]);
    res.json(full[0]);
  })
);

// Accepting Authority's action: manual mark, never auto-derived from the bands.
router.put(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "Work Allocation Order id");
    const mark = requireNumber(req.body.mark, "Mark");
    const acceptedBy = requireString(req.body.acceptedBy, "Accepting authority");

    // Save the mark and who accepted it — but only if this order is
    // currently "Submitted". If someone already accepted/rejected it (or it's
    // still waiting on the employee), "AND status = 'Submitted'" means this
    // update matches zero rows instead of silently double-processing it.
    const { rows } = await pool.query(
      `UPDATE work_allocation_orders
       SET mark = $1, accepted_by = $2, accepted_date = CURRENT_DATE, status = 'Accepted'
       WHERE id = $3 AND status = 'Submitted' RETURNING id`,
      [mark, acceptedBy, id]
    );
    if (!rows[0]) throw new ApiError(409, "This order is not awaiting review (already actioned or not yet submitted).");

    const { rows: full } = await pool.query(`${WAO_SELECT} WHERE w.id = $1`, [id]);
    res.json(full[0]);
  })
);

// Accepting Authority's action: send it back to the employee instead of accepting it.
router.put(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "Work Allocation Order id");

    // Same guard as /accept — only works on an order that's currently "Submitted".
    const { rows } = await pool.query(
      `UPDATE work_allocation_orders SET status = 'Rejected'
       WHERE id = $1 AND status = 'Submitted' RETURNING id`,
      [id]
    );
    if (!rows[0]) throw new ApiError(409, "This order is not awaiting review (already actioned or not yet submitted).");

    const { rows: full } = await pool.query(`${WAO_SELECT} WHERE w.id = $1`, [id]);
    res.json(full[0]);
  })
);

module.exports = router;
