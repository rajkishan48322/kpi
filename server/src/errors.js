"use strict";

/** An error with an explicit HTTP status, safe to surface to the client as-is. */
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Wraps an async Express handler so rejected promises reach the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Postgres error codes we translate into meaningful HTTP responses.
// See https://www.postgresql.org/docs/current/errcodes-appendix.html
const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_CHECK_VIOLATION = "23514";
const PG_NOT_NULL_VIOLATION = "23502";
const PG_RAISE_EXCEPTION = "P0001"; // our own trigger-raised business rule violations

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message });
  }

  switch (err.code) {
    case PG_UNIQUE_VIOLATION:
      return res.status(409).json({ error: "That value already exists and must be unique." });
    case PG_FOREIGN_KEY_VIOLATION:
      return res.status(409).json({ error: "This record is referenced elsewhere and cannot be changed as requested." });
    case PG_CHECK_VIOLATION:
    case PG_NOT_NULL_VIOLATION:
    case PG_RAISE_EXCEPTION:
      return res.status(400).json({ error: err.message.replace(/^error: /i, "") });
    default:
      break;
  }

  console.error(err);
  return res.status(500).json({ error: "Internal server error." });
}

module.exports = { ApiError, asyncHandler, errorHandler };
