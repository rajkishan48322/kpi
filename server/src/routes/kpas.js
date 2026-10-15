"use strict";

const express = require("express");
const { pool, withTransaction } = require("../db");
const { asyncHandler, ApiError } = require("../errors");
const {
  requireString,
  optionalString,
  requireOneOf,
  requireNumber,
  optionalNumber,
  requireId,
} = require("../validate");

// Same request -> database -> response pattern as departments.js.
const router = express.Router();

// The only two directions a metric can be scored in.
const DIRECTIONS = ["higher-better", "lower-better"];
// The only three places a metric's actual figure is allowed to come from.
const SOURCES = ["GC", "WB", "Manual"];

// A reusable chunk of SQL: get a KPA's own columns, plus all of its scoring
// bands bundled together into one JSON list (instead of one separate row per
// band) — this is what lets api.kpas.list() hand back each KPA already
// including its whole scoring chart in a single request.
const KPA_WITH_BANDS_SELECT = `
  SELECT
    k.id, k.code, k.name, k.definition, k.unit, k.direction, k.source,
    COALESCE(
      json_agg(
        json_build_object(
          'id', b.id, 'label', b.label, 'minDelta', b.min_delta,
          'maxDelta', b.max_delta, 'mark', b.mark, 'sortOrder', b.sort_order
        ) ORDER BY b.sort_order
      ) FILTER (WHERE b.id IS NOT NULL),
      '[]'
    ) AS bands
  FROM kpas k
  LEFT JOIN kpa_bands b ON b.kpa_id = k.id
`;

// Looks up one KPA (with its bands) by id, using the SQL above. Used after a
// create/update/bands-save so the handler can hand back the freshly-saved,
// complete record.
async function fetchKpaWithBands(id) {
  const { rows } = await pool.query(
    `${KPA_WITH_BANDS_SELECT} WHERE k.id = $1 GROUP BY k.id`,
    [id]
  );
  return rows[0] || null;
}

// GET /api/kpas — every KPA, each with its bands attached.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`${KPA_WITH_BANDS_SELECT} GROUP BY k.id ORDER BY k.code`);
    res.json(rows);
  })
);

// POST /api/kpas — save a brand-new metric.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    // Check every required field is present and valid before saving anything.
    const code = requireString(req.body.code, "KPA code");
    const name = requireString(req.body.name, "KPA name");
    const definition = optionalString(req.body.definition);
    const unit = optionalString(req.body.unit);
    const direction = requireOneOf(req.body.direction, DIRECTIONS, "Direction");
    const source = requireOneOf(req.body.source, SOURCES, "Source");

    // Insert the new row (it won't have any bands yet — those come from a
    // separate save, see PUT /:id/bands below).
    const { rows } = await pool.query(
      `INSERT INTO kpas (code, name, definition, unit, direction, source)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [code, name, definition, unit, direction, source]
    );
    // Reply with the full, freshly-saved record (bands included, even though empty).
    res.status(201).json(await fetchKpaWithBands(rows[0].id));
  })
);

// PUT /api/kpas/:id — edit an existing metric's own fields (not its bands).
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "KPA id");
    const code = requireString(req.body.code, "KPA code");
    const name = requireString(req.body.name, "KPA name");
    const definition = optionalString(req.body.definition);
    const unit = optionalString(req.body.unit);
    const direction = requireOneOf(req.body.direction, DIRECTIONS, "Direction");
    const source = requireOneOf(req.body.source, SOURCES, "Source");

    const { rowCount } = await pool.query(
      `UPDATE kpas SET code = $1, name = $2, definition = $3, unit = $4, direction = $5, source = $6
       WHERE id = $7`,
      [code, name, definition, unit, direction, source, id]
    );
    if (!rowCount) throw new ApiError(404, "KPA not found.");
    res.json(await fetchKpaWithBands(id));
  })
);

// DELETE /api/kpas/:id — remove a metric (and, because of how the database
// tables are linked, its bands get removed automatically along with it).
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = requireId(req.params.id, "KPA id");
    const { rowCount } = await pool.query("DELETE FROM kpas WHERE id = $1", [id]);
    if (!rowCount) throw new ApiError(404, "KPA not found.");
    res.status(204).end();
  })
);

// Replace the full set of marking-scale bands for one KPA in a single transaction.
router.put(
  "/:id/bands",
  asyncHandler(async (req, res) => {
    const kpaId = requireId(req.params.id, "KPA id");
    // The browser must send a list of bands, even if it's empty — anything
    // else is a mistake in the request.
    if (!Array.isArray(req.body.bands)) {
      throw new ApiError(400, "bands must be an array.");
    }

    // Check every band in the list is valid, and give each one its position
    // in the list (sortOrder) so they're checked top-to-bottom in that order later.
    const bands = req.body.bands.map((b, i) => ({
      label: requireString(b.label, `Band ${i + 1} label`),
      minDelta: optionalNumber(b.minDelta, `Band ${i + 1} min delta`),
      maxDelta: optionalNumber(b.maxDelta, `Band ${i + 1} max delta`),
      mark: requireNumber(b.mark, `Band ${i + 1} mark`),
      sortOrder: i + 1,
    }));

    // Do the "wipe out the old bands, write in the new ones" as one
    // all-or-nothing transaction (see withTransaction in db.js) — so if
    // anything fails partway through, the old bands are left untouched
    // rather than ending up half-replaced.
    await withTransaction(async (client) => {
      // Make sure this KPA actually exists before touching its bands.
      const { rowCount } = await client.query("SELECT 1 FROM kpas WHERE id = $1", [kpaId]);
      if (!rowCount) throw new ApiError(404, "KPA not found.");

      // Remove every existing band for this KPA...
      await client.query("DELETE FROM kpa_bands WHERE kpa_id = $1", [kpaId]);
      // ...then insert every band from the new list, one at a time.
      for (const b of bands) {
        await client.query(
          `INSERT INTO kpa_bands (kpa_id, label, min_delta, max_delta, mark, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [kpaId, b.label, b.minDelta, b.maxDelta, b.mark, b.sortOrder]
        );
      }
    });

    // Reply with the KPA's full, freshly-saved band list.
    res.json(await fetchKpaWithBands(kpaId));
  })
);

// Reference-only suggested mark for a target/actual pair, from the DB's fn_suggested_mark().
router.get(
  "/:id/suggested-mark",
  asyncHandler(async (req, res) => {
    const kpaId = requireId(req.params.id, "KPA id");
    // These come from the web address's "?target=...&actual=..." part, and
    // are allowed to be missing (hence "optional").
    const target = optionalNumber(req.query.target, "target");
    const actual = optionalNumber(req.query.actual, "actual");
    // Ask the database's own built-in calculator function for its suggestion
    // — it runs the exact same band-matching logic as the live preview in
    // the browser (see client/js/util.js), just as the authoritative version.
    const { rows } = await pool.query(
      "SELECT fn_suggested_mark($1, $2, $3) AS mark",
      [kpaId, target, actual]
    );
    res.json({ mark: rows[0] ? rows[0].mark : null });
  })
);

module.exports = router;
