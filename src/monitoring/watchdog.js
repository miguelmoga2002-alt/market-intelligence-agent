"use strict";

/**
 * Watchdog - production health checks.
 *
 * The system runs 24/7 and ingests continuously, so the failure mode that matters is
 * the SILENT one: a step that runs but stops producing. The core principle here is
 * "check that the system PRODUCES output, not just that the process is alive."
 *
 * Two ideas from the real system are shown:
 *   1. Each check targets the REAL signal of its component (a fresh row, a recent file,
 *      a non-empty result) - not a generic "is the process up".
 *   2. Every alert carries a "GO TO": the exact command to diagnose it and how to read
 *      the result, so an alert is actionable instead of just noise.
 *
 * Portfolio note: checks below run against fictional inputs so the file is runnable.
 * The real watchdog has 20+ checks and persists every incident to a table so the
 * failure history is queryable (see the "Production Health" dashboard screenshot).
 */

/** A check returns { name, ok, detail, goTo }. */
function makeCheck(name, fn, goTo) {
  return async (ctx) => {
    try {
      const { ok, detail } = await fn(ctx);
      return { name, ok, detail, goTo: ok ? null : goTo };
    } catch (err) {
      return { name, ok: false, detail: `check threw: ${err.message}`, goTo };
    }
  };
}

// --- example checks ---------------------------------------------------------

const checks = [
  // Data freshness: did new data arrive recently? (produces, not just runs)
  makeCheck(
    "ingest_freshness",
    async (ctx) => {
      const ageMin = ctx.minutesSinceLastRow;
      return { ok: ageMin < 180, detail: `last row ${ageMin} min ago` };
    },
    "Inspect the latest ingest log and the DB max(seen_at). If stale, the scraper " +
      "step is not writing - check for auth/session errors before restarting."
  ),

  // Classifier output: is the pipeline still classifying, or silently passing junk?
  makeCheck(
    "classifier_output",
    async (ctx) => {
      const pct = ctx.classifiedPct;
      return { ok: pct >= 90, detail: `${pct}% classified in last batch` };
    },
    "A broken classifier does not error - it just stops matching. Diff the last batch " +
      "against a known-good one and check the classifier rules, then backfill."
  ),

  // Anti-wipe guard: did a run return far fewer rows than the accumulated total?
  makeCheck(
    "anti_wipe_guard",
    async (ctx) => {
      const ratio = ctx.runRows / Math.max(1, ctx.accumulatedRows);
      return { ok: ratio >= 0.5, detail: `run/accumulated = ${(ratio * 100).toFixed(0)}%` };
    },
    "A run returning <50% of the accumulated catalog is suspicious (a bad/empty run). " +
      "The writer must NOT overwrite in that case - verify the guard tripped and the " +
      "previous data is intact."
  ),

  // Alert-channel liveness: is the fraud filter still catching anything?
  makeCheck(
    "fraud_filter_alive",
    async (ctx) => {
      return { ok: ctx.fraudFlaggedToday > 0, detail: `${ctx.fraudFlaggedToday} flagged today` };
    },
    "If this drops to 0 the filter regex may have died (it fails silently). Test it " +
      "against known-bad historical samples, not just today's clean data."
  )
];

/** Run all checks against a context object and return a report. */
async function runChecks(ctx) {
  const results = await Promise.all(checks.map((c) => c(ctx)));
  const failing = results.filter((r) => !r.ok);
  return {
    healthy: failing.length === 0,
    total: results.length,
    failing: failing.length,
    results
  };
}

module.exports = { runChecks, checks };

// Demo run when executed directly.
if (require.main === module) {
  runChecks({
    minutesSinceLastRow: 42,
    classifiedPct: 96,
    runRows: 1500,
    accumulatedRows: 2000,
    fraudFlaggedToday: 18
  }).then((r) => console.log(JSON.stringify(r, null, 2)));
}
