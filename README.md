# Market Intelligence Agent

**A production AI agent that turns 10-15K daily marketplace listings into the handful of
profitable opportunities worth acting on.**

A local LLM (Ollama / Qwen) answers natural-language questions over a live PostgreSQL
database of 400K+ marketplace listings — *without ever writing SQL itself*. The model
chooses **which typed tool to call** and with **which parameters**; deterministic code
validates every argument against a whitelist and runs read-only, parametrized queries.
No cloud API, no data leaving the machine.

> **Context.** I'm a self-taught developer. This is a sanitized portfolio extract of a
> larger system I designed, built, and operate 24/7 for a family reselling business —
> it monitors second-hand marketplaces to save manual research time and surface buying
> opportunities. The scoring logic and data sources are the core of the business and are
> **not** included here; the code in this repo is demo code with fictional data. What's
> shown is the architecture and the engineering.

---

## The problem

Scanning the market by hand is impossible. The database holds 500K+ listings with
10-15K new ones a day across several verticals (PC components, machinery, bikes). A fixed
set of dashboards can't answer the long tail of natural questions — *"what's a used RTX
4070 going for, and where is it cheapest?"*, *"how many sold this month?"*, *"compare the
4070 vs the 4070 Ti"*. I needed an automatic funnel with judgment: from 10-15K raw
listings a day down to the ~10-15 opportunities actually worth acting on.

## What it does

Three layers turn raw listings into decisions (full detail in
[docs/architecture.md](docs/architecture.md)):

```
  Scrapers (Playwright) → PostgreSQL (ingest → classify → value)
  → Scoring engine → LLM Agent (Ollama/Qwen + tool calling)
  → Metabase dashboards + Telegram alerts
```

The system runs 24/7. It scans the market while I sleep or work, flags opportunities, and
I review and buy when one fits — replacing hours of manual research a day.

![Ecosystem scale](docs/screenshots/ecosystem-scale.png)

## The AI agent

The model **never writes SQL**. It's given a catalog of typed tools; it reads the question
and returns which tool(s) to call and what parameters to pass. The code owns the query.

```
   user question ─▶ Agent ──(question + tool schemas)──▶ Local LLM (Ollama/Qwen)
                      │                                        │
                      │        ◀──(tool_calls: which tool, ────┘
                      │            which params)
                      ▼
             validate params  ──▶  run read-only, parametrized SQL  ──▶  real rows
                      │                                                     │
                      └──────────(rows back to the model)──▶ LLM writes final answer
```

Three patterns were built and compared — a fixed intent-routed catalog, an LLM that writes
SQL (contained by a read-only role), and this one, typed tool calling. **Tool calling
won**: it keeps the flexibility of natural language while making unsafe output
*structurally* impossible — there is no code path where model output becomes a query
string. ([Why, in detail.](docs/architecture.md#the-agent-why-tool-calling))

**Safety, three layers:** the model only emits `{tool, params}`; every query is
parametrized with bound values; the database user is read-only. On top of that — *the
model proposes, the code validates*: any parameter outside the whitelist is dropped and
reported, never silently used.

The tools: `search_listings`, `count`, `median_price`, `opportunities`
([definitions](src/tools/index.js)). The agent chains calls — a comparison of two models
fires two `median_price` calls, then one written summary. See
[examples/expected_output.md](examples/expected_output.md).

## Engineering for production

What separates this from a hobby project:

- **A watchdog that checks output, not liveness** — 20+ checks, each targeting the real
  signal of its component, tested against known-bad historical inputs (because "0 alerts"
  only proves no false positives, not that the check works).
  ![Production health](docs/screenshots/production-health.png)
- **An anti-wipe guard** — a run returning far fewer rows than the accumulated catalog
  refuses to overwrite and alerts, so one bad run can't erase weeks of data.
- **Observability as data** — every incident is written to a table, so the failure
  history is queryable and charted.
- **Tested backups and least privilege** — backups are restore-tested; the agent runs
  read-only.

The data pipeline that feeds all this — ingest, classification, junk-filtering — is a
system in itself:

![Data quality pipeline](docs/screenshots/data-quality-pipeline.png)

## Tech stack

JavaScript · TypeScript · Node.js · PostgreSQL · Playwright · Ollama / Qwen 2.5 ·
n8n · Metabase. Designed to run 24/7 on a single server.

## Running

The demo code runs with fictional data. The agent needs a local
[Ollama](https://ollama.com) with a tool-capable model:

```bash
npm run check                      # syntax-check all modules
node src/monitoring/watchdog.js    # run the health checks against sample input
node examples/ask.js "what's the RTX 4070 going for?"
node examples/ask.js "compare the RTX 4070 and the 4070 Ti"
```

(No Ollama? [examples/expected_output.md](examples/expected_output.md) shows what a run
looks like.)

## Repository layout

```
src/agent/       the agent: tool-calling loop + whitelist validation
src/tools/       typed tool definitions the model can call
src/db/          SQL schema, example read queries, data-access layer
src/monitoring/  watchdog / health checks
examples/        runnable usage examples
docs/            architecture + dashboard screenshots
```

## A note on scope

This repo shows the **architecture and patterns**. The scoring logic, price thresholds,
data sources, and the exact models that carry margin are private — they're the core of the
business. That boundary is deliberate: a portfolio should demonstrate how you build, not
give away what makes the system work.

## License

MIT — see [LICENSE](LICENSE).
