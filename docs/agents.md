# The AI agents

Every model in the system runs locally through Ollama (Qwen 2.5 14B on a 24 GB GPU). Nothing is
sent to a cloud AI service.

## The principle

**Code detects and calculates. The model translates between people and code.**

I learned this the same way four times. A bike prompt that asked "is this a part?" found parts
everywhere. The data bot wrote numbers and links that were not in its data. A model asked "what
problems do you see?" in the system logs reported a full disk. A verifier asked "is this a good
deal?" said yes. Each time the fix was the same: take judgment and figures away from the model,
give it a narrow question, and let code do the rest.

The disk case had a twist worth keeping. The model had not invented it: a hardware sensor
reported a network drive as 0% free, and the model only repeated it. The bug surfaced when I took
the model out of that path. If the data is wrong, no layer above it can fix it.

## 1. Data agent

A Telegram bot, running 24/7 as a Windows service, that answers business questions in plain
language: what a part is going for, where it is cheapest, how fast a model sells, what the best
open opportunities are, a chart of a price trend.

### A cascade ordered by trust

Each question goes down a cascade and stops at the first tier that can answer it. The order is
deliberate: the cheaper and safer the tier, the earlier it runs.

| Tier | Who decides | What runs |
|---|---|---|
| 1. Deterministic commands | Code | Operations ledger, valuation of a list of parts with the same functions production scoring uses, "can I shut the server down now?" from the real process list, business snapshot |
| 2. Routing | Code | System and hardware questions go to the ops agent |
| 3. Typed tools | Model picks tool and arguments | Read-only, parametrized queries; the model can chain several |
| 4. Verified catalog | Model picks one of 26 hand-written queries and extracts parameters | Parametrized queries, charts, watch alerts |
| 5. Model-written SQL | Model, as a last resort | Read-only role, SELECT-only validator, forced row limit, statement timeout |

The answer is written by the model from the rows that came back, never from memory. Prices and
links are formatted by code, and any link that is not in the rows is stripped before the message
is sent. Every question that falls through to tier 5 is logged, so the verified catalog grows
from real use instead of from guesses.

### Why all three patterns

| Pattern | Strength | Weakness | Where it sits |
|---|---|---|---|
| Fixed catalog | Safe, fast, verified | Every new question needs a new query | Tier 4 |
| Typed tool calling | Flexible and still structured: the model returns `{tool, params}`, never a query | Only covers what the tools cover | Tier 3 |
| Model-written SQL | Can answer anything in the schema | Invents columns and figures if left unchecked | Tier 5, sandboxed |

The model-written tier sees the full schema with plain-language notes (which table answers what,
which columns do not exist where, where coverage is thin), because without them it invents
columns. Its safety does not depend on the prompt: the database role cannot write, the validator
rejects anything that is not a single SELECT, and the row limit and timeout are forced.

### Two paths that never mix

The operations ledger (real purchases and sales, including teardowns where one purchase becomes
several sales) writes to the database with fixed, parametrized SQL and no model in the path. The
agent reads through a read-only role. The two paths share nothing.

## 2. Inventory verifier

It reviews candidate complete PCs before they are reported. The verifier never answers "is this
a good deal?". It answers "what is in the box?": the components present, what is missing and
what is broken. The code then values the parts and decides.

- **Worth it as a teardown:** alert with the breakdown.
- **Not worth it:** silence.
- **Very cheap with no visible reason:** a separate *verify in person* alert. A deal is never
  hidden for being cheap; its confidence is labeled instead.

A missing graphics card is not a reason to discard a PC. It is information to value it again: a
high-end platform without a card can still be worth more than its asking price. That rule came
from a real purchase that made its margin as a teardown, not from the model.

Teardown lines also carry precision flags for the classic traps: a price that excludes the
graphics card, configurator-style listings and ads that name several models.

## 3. Listing verifier

Before a bike deal is reported, the model decides what is actually being sold. The first prompts
listed the parts of a bike so the model could spot listings that were only parts. It did the
opposite: a normal listing that enumerated its components (wheels, groupset, handlebar) was read
as a part, and complete high-end bikes were discarded. The version that works asks "what is
being sold?" and tells the model that listing components is normal for a complete bike.

## 4. Ops agent

A second Telegram bot for the system itself.

- **Diagnosis:** status of jobs, locks and services, and hardware sensors (temperatures, VRAM,
  RAM, disk). It reads and warns; it never controls fans or power. Reading and warning is most of
  the value with none of the risk.
- **Actions from a closed catalog:** restart a whitelisted service, brake one radar, list the
  radars that are braked. Each action needs a confirmation within 60 seconds, and the name that is
  executed is taken from the system's own list of services and jobs, never from the text of the
  message.
- **Routing:** a deterministic classifier sends data questions to the data agent and system
  questions here, with a link to the right bot.

## Where the model was taken out

- **Watchdog alerts.** They used to be queued for the model to explain. It repeated them and once
  advised re-running a collector whose IP was blocked. Alerts now go out exactly as the check
  wrote them.
- **The daily summary and the business snapshot.** Computed by code. Numbers never pass through
  the model.

## Models and hardware

The model choice is a VRAM budget. The 14B model takes about 10 GB and has to coexist with other
local workloads on the same card, so peak and resident memory are measured before anything new
is added. A second GPU is reserved for the next agent: a vision model that reads the part numbers
on photos of memory modules.
