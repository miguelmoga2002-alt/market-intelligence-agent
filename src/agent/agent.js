"use strict";

/**
 * The agent: a tool-calling loop over a LOCAL LLM (Ollama / Qwen).
 *
 * Flow:
 *   1. Send the user's question + the typed tool schemas to the model.
 *   2. The model replies with tool_calls: which tool(s) to run and with what params.
 *      (The model never writes SQL. It only chooses tools and arguments.)
 *   3. For each call: validate params against the whitelist, then run the tool
 *      (which executes read-only, parametrized SQL) and collect the real rows.
 *   4. Send the results back to the model so it writes the final answer, grounded
 *      in real data rather than invented figures.
 *
 * Three patterns were built and compared for this system (see docs/architecture.md):
 *   (a) a fixed catalog of intent-routed queries,
 *   (b) an LLM that writes SQL, contained by a read-only DB user,
 *   (c) this one — typed tool calling.
 * (c) won: it keeps the model's flexibility while making unsafe output structurally
 * impossible (there is no code path where model output becomes a query string).
 *
 * Portfolio note: the Ollama call is real and correct; run against a local Ollama with
 * a tool-capable model. Data and tools here are demo.
 */

const { TOOLS } = require("../tools");
const { validateParams } = require("./validate");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/api/chat";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:14b";

const SYSTEM_PROMPT =
  "You are a market-intelligence assistant. When the user asks for data a tool can " +
  "provide, CALL IT with correct parameters; do not answer from memory. " +
  "Rules: (1) for price / median / 'what's it going for', ALWAYS use median_price, " +
  "never search_listings (that only lists rows). (2) If the question compares or names " +
  "SEVERAL models, call the tool ONCE PER MODEL in the same turn. Then summarize the " +
  "results briefly. Never invent figures.";

/** Low-level call to the local model. */
async function chat(messages, tools) {
  const body = {
    model: MODEL,
    stream: false,
    messages,
    options: { temperature: 0.15 }
  };
  if (tools) body.tools = tools;

  const res = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.message || {};
}

/**
 * Answer a natural-language question.
 * Returns { answer, toolsUsed, warnings }.
 */
async function ask(question) {
  const toolSchemas = Object.values(TOOLS).map((t) => ({ type: "function", function: t.schema }));

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: question }
  ];

  // Step 1-2: let the model choose tools.
  const first = await chat(messages, toolSchemas);
  const calls = first.tool_calls || [];

  // No tool chosen -> the model answered directly (or couldn't). Return its text.
  if (!calls.length) {
    return { answer: first.content || "", toolsUsed: [], warnings: [] };
  }

  // Step 3: execute each chosen tool, validating params first.
  const toolsUsed = [];
  const allWarnings = [];
  messages.push({ role: "assistant", content: first.content || "", tool_calls: calls });

  for (const call of calls) {
    const name = call.function && call.function.name;
    const tool = TOOLS[name];
    if (!tool) {
      allWarnings.push(`model requested unknown tool '${name}'`);
      continue;
    }

    const rawArgs =
      typeof call.function.arguments === "string"
        ? safeParse(call.function.arguments)
        : call.function.arguments || {};

    const { params, warnings } = validateParams(name, rawArgs);
    allWarnings.push(...warnings);

    let result;
    try {
      result = await tool.run(params);
    } catch (err) {
      result = { error: String(err.message || err) };
    }

    toolsUsed.push({ tool: name, params });
    messages.push({ role: "tool", name, content: JSON.stringify(result) });
  }

  // Step 4: model writes the final answer from the real results.
  const second = await chat(messages, toolSchemas);
  return { answer: second.content || "", toolsUsed, warnings: allWarnings };
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

module.exports = { ask, SYSTEM_PROMPT };
