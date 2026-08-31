"use strict";

/**
 * Parameter validation — the security boundary between the model and the database.
 *
 * The model proposes {tool, params}. Before those params reach any query, they pass
 * through here. The rule is: "the model proposes, the code validates." Anything the
 * model invents that falls outside the whitelist is dropped and reported, never
 * silently used.
 *
 * This is what stops a hallucinated enum value, an out-of-range limit, or a wrong-typed
 * argument from ever touching the data layer.
 */

const { VERTICALS, PLATFORMS, ITEM_TYPES, ORDERS } = require("../tools");

const ENUMS = {
  vertical: VERTICALS,
  platform: PLATFORMS,
  item_type: ITEM_TYPES,
  order: ORDERS,
  status: ["available", "reserved", "sold"]
};

/**
 * Validate and normalize a params object for a given tool.
 * Returns { ok, params, warnings }.
 * - Unknown enum values are removed (not passed through) and a warning is recorded.
 * - Numeric fields are coerced and clamped to safe ranges.
 * - Free-text is trimmed and length-capped.
 */
function validateParams(toolName, rawParams) {
  const params = {};
  const warnings = [];
  const input = rawParams && typeof rawParams === "object" ? rawParams : {};

  for (const [key, value] of Object.entries(input)) {
    // Enum fields: must be in the whitelist.
    if (ENUMS[key]) {
      if (typeof value === "string" && ENUMS[key].includes(value)) {
        params[key] = value;
      } else {
        warnings.push(
          `dropped ${key}='${value}' (not in whitelist [${ENUMS[key].join(", ")}])`
        );
      }
      continue;
    }

    // Numeric fields.
    if (key === "max_price" || key === "min_margin" || key === "days" || key === "limit") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        warnings.push(`dropped ${key}='${value}' (not a valid non-negative number)`);
        continue;
      }
      params[key] = key === "limit" ? Math.min(Math.max(Math.floor(n), 1), 50) : n;
      continue;
    }

    // Free-text query.
    if (key === "query") {
      if (typeof value === "string" && value.trim()) {
        params[key] = value.trim().slice(0, 100);
      } else {
        warnings.push(`dropped query='${value}' (empty or non-string)`);
      }
      continue;
    }

    // Unknown field: ignore it rather than forwarding blindly.
    warnings.push(`ignored unknown field '${key}'`);
  }

  return { ok: true, params, warnings };
}

module.exports = { validateParams, ENUMS };
