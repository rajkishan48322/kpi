"use strict";

// "pg" is the library that actually knows how to speak PostgreSQL's network
// protocol. Pool manages connections (see below); types lets us control how
// raw database values get converted into JavaScript values.
const { Pool, types } = require("pg");

// node-postgres returns bigint and numeric columns as strings by default, to
// avoid silent precision loss on values beyond Number.MAX_SAFE_INTEGER or with
// more precision than a float64 can hold. This app's ids and figures (weightages,
// marks, target/actual values) never approach those limits, so we opt back into
// plain JS numbers here rather than threading string<->number conversions
// through every route and every screen.
// Whenever a "bigint" database column (used for every table's id) comes back,
// convert it from text into a real JavaScript whole number.
types.setTypeParser(types.builtins.INT8, (val) => parseInt(val, 10));
// Whenever a "numeric" column (weightages, marks, target/actual values) comes
// back, convert it into a real JavaScript decimal number — unless it's genuinely empty (null).
types.setTypeParser(types.builtins.NUMERIC, (val) => (val === null ? null : parseFloat(val)));
// `date` is otherwise parsed into a JS Date at UTC midnight, which is a classic
// source of off-by-one-day bugs once it round-trips through a timezone. Keep it
// as the plain 'YYYY-MM-DD' string Postgres sends.
// So: leave "date" columns exactly as the plain text Postgres already sends, untouched.
types.setTypeParser(types.builtins.DATE, (val) => val);

// This is the actual wire between this Node.js server and the real PostgreSQL
// database sitting elsewhere (configured via the DB_HOST/DB_NAME/etc. settings
// below). `Pool` keeps a small group of already-open connections to the
// database ready to go, so when several browser requests arrive close
// together, each one can borrow a connection immediately instead of waiting
// in line for a single shared one. Every routes file (departments.js,
// employees.js, etc.) uses this same `pool` to run its SQL commands.
const pool = new Pool({
  host: process.env.DB_HOST, // which computer the database lives on
  port: Number(process.env.DB_PORT) || 5432, // which network port it's listening on (5432 is Postgres's usual one)
  database: process.env.DB_NAME, // which database (by name) to connect to
  user: process.env.DB_USER, // the database login username
  password: process.env.DB_PASSWORD, // the database login password
  max: 10, // never keep more than 10 connections open at once
  idleTimeoutMillis: 30000, // close a connection if it sits unused for 30 seconds
  connectionTimeoutMillis: 5000, // give up trying to connect after 5 seconds
});

// If a connection that's just sitting idle in the pool fails for some reason
// (e.g. the database restarted), log it instead of letting it crash the whole server.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client:", err);
});

// Runs several database changes together as one all-or-nothing unit (a
// "transaction") — if anything inside `fn` fails, every change made so far
// is undone (ROLLBACK) instead of leaving the database half-updated.
async function withTransaction(fn) {
  // Borrow one connection from the pool for this whole transaction.
  const client = await pool.connect();
  try {
    // Tell the database "everything from here on is one unit" until COMMIT/ROLLBACK.
    await client.query("BEGIN");
    // Run the caller's actual database work, using this same connection.
    const result = await fn(client);
    // Everything succeeded — make all those changes permanent.
    await client.query("COMMIT");
    return result;
  } catch (err) {
    // Something failed — undo every change made since BEGIN.
    await client.query("ROLLBACK");
    throw err; // let the caller know it failed
  } finally {
    // Always give the connection back to the pool when done, whether it succeeded or not.
    client.release();
  }
}

module.exports = { pool, withTransaction };
