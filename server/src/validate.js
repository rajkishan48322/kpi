"use strict";

const { ApiError } = require("./errors");

function requireString(value, fieldLabel) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${fieldLabel} is required.`);
  }
  return value.trim();
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function requireOneOf(value, allowed, fieldLabel) {
  if (!allowed.includes(value)) {
    throw new ApiError(400, `${fieldLabel} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function requireNumber(value, fieldLabel) {
  const num = typeof value === "number" ? value : parseFloat(value);
  if (Number.isNaN(num)) {
    throw new ApiError(400, `${fieldLabel} must be a number.`);
  }
  return num;
}

function optionalNumber(value, fieldLabel) {
  if (value === undefined || value === null || value === "") return null;
  return requireNumber(value, fieldLabel);
}

function requireId(value, fieldLabel) {
  const num = parseInt(value, 10);
  if (Number.isNaN(num)) {
    throw new ApiError(400, `${fieldLabel} must be a valid id.`);
  }
  return num;
}

const PERIOD_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

function requirePeriod(value) {
  if (typeof value !== "string" || !PERIOD_PATTERN.test(value)) {
    throw new ApiError(400, "Period must be in YYYY-MM format.");
  }
  return value;
}

module.exports = {
  requireString,
  optionalString,
  requireOneOf,
  requireNumber,
  optionalNumber,
  requireId,
  requirePeriod,
};
