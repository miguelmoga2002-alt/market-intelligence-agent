"use strict";

/**
 * Data-access layer: read-only, parametrized SQL.
 *
 * Two design points that matter:
 *   1. Every query is hand-written with a fixed shape and uses bound parameters
 *      ($1, $2, ...). Values coming from the model are passed as parameters, never
 *      concatenated into the SQL string.
 *   2. The database connection uses a READ-ONLY role. Even a hypothetical bad query
 *      cannot modify data — the permission model enforces it, not a prompt.
 *
 * Portfolio note: to keep the sample runnable without a database, the functions below
 * return fictional in-memory data. The real system runs these against PostgreSQL via a
 * read-only user. The SQL each function *would* run is shown in a comment so a reviewer
 * can see the query shape.
 */

// --- fictional sample data (stands in for the read-only DB) -----------------
const SAMPLE = [
  { id: 1, model: "rtx 4070", vertical: "pc", platform: "market_a", price: 520, status: "available" },
  { id: 2, model: "rtx 4070", vertical: "pc", platform: "market_b", price: 545, status: "available" },
  { id: 3, model: "rtx 4070", vertical: "pc", platform: "market_a", price: 560, status: "sold" },
  { id: 4, model: "rtx 4070 ti", vertical: "pc", platform: "market_a", price: 590, status: "available" },
  { id: 5, model: "rtx 4070 ti", vertical: "pc", platform: "market_c", price: 610, status: "available" },
  { id: 6, model: "rtx 4070 ti", vertical: "pc", platform: "market_b", price: 600, status: "sold" }
];

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
function percentile(nums, p) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function matches(row, params) {
  if (params.query && !row.model.includes(params.query.toLowerCase())) return false;
  if (params.vertical && row.vertical !== params.vertical) return false;
  if (params.platform && row.platform !== params.platform) return false;
  return true;
}

// --- tools ------------------------------------------------------------------

/**
 * SQL shape:
 *   SELECT id, model, platform, price, status
 *   FROM listings
 *   WHERE model ILIKE '%' || $1 || '%'
 *     AND ($2::text IS NULL OR vertical = $2)
 *     AND ($3::numeric IS NULL OR price <= $3)
 *   ORDER BY <order>  LIMIT $4;
 */
async function searchListings(params) {
  let rows = SAMPLE.filter((r) => matches(r, params));
  if (params.max_price != null) rows = rows.filter((r) => r.price <= params.max_price);

  const order = params.order || "newest";
  if (order === "cheapest") rows.sort((a, b) => a.price - b.price);
  else if (order === "price_desc") rows.sort((a, b) => b.price - a.price);
  else rows.sort((a, b) => b.id - a.id); // "newest"

  const limit = params.limit || 20;
  return rows.slice(0, limit).map(({ id, model, platform, price, status }) => ({
    id, model, platform, price, status
  }));
}

/**
 * SQL shape:
 *   SELECT count(*) FROM listings
 *   WHERE (... same optional filters ...)
 *     AND ($n::int IS NULL OR seen_at >= now() - ($n || ' days')::interval);
 */
async function count(params) {
  let rows = SAMPLE.filter((r) => matches(r, params));
  if (params.status) rows = rows.filter((r) => r.status === params.status);
  return { count: rows.length };
}

/**
 * SQL shape:
 *   SELECT
 *     percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS median,
 *     percentile_cont(0.25) WITHIN GROUP (ORDER BY price) AS p25,
 *     percentile_cont(0.75) WITHIN GROUP (ORDER BY price) AS p75,
 *     min(price), max(price), count(*)
 *   FROM listings
 *   WHERE model ILIKE '%' || $1 || '%' AND (...);
 */
async function medianPrice(params) {
  const rows = SAMPLE.filter((r) => matches(r, params));
  const prices = rows.map((r) => r.price);
  if (!prices.length) return { query: params.query, samples: 0, median: null };

  // by platform
  const byPlatform = {};
  for (const r of rows) (byPlatform[r.platform] ||= []).push(r.price);
  const platforms = Object.fromEntries(
    Object.entries(byPlatform).map(([k, v]) => [k, { median: median(v), samples: v.length }])
  );

  return {
    query: params.query,
    samples: prices.length,
    median: median(prices),
    p25: percentile(prices, 25),
    p75: percentile(prices, 75),
    min: Math.min(...prices),
    max: Math.max(...prices),
    by_platform: platforms
  };
}

/**
 * SQL shape (results of an upstream scoring step, read-only):
 *   SELECT id, model, price, margin FROM opportunities
 *   WHERE ($1::text IS NULL OR vertical = $1)
 *     AND ($2::numeric IS NULL OR margin >= $2)
 *   ORDER BY margin DESC LIMIT $3;
 */
async function opportunities(params) {
  // fictional: derive a toy "margin" as sold-median minus available price
  const soldMedian = median(SAMPLE.filter((r) => r.status === "sold").map((r) => r.price)) || 0;
  let rows = SAMPLE.filter((r) => r.status === "available" && matches(r, params)).map((r) => ({
    id: r.id, model: r.model, price: r.price, margin: Math.max(0, soldMedian - r.price)
  }));
  if (params.min_margin != null) rows = rows.filter((r) => r.margin >= params.min_margin);
  rows.sort((a, b) => b.margin - a.margin);
  return rows.slice(0, params.limit || 20);
}

module.exports = { searchListings, count, medianPrice, opportunities };
