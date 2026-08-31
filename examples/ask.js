"use strict";

/**
 * Example: ask the agent a question.
 *
 * Requires a local Ollama running a tool-capable model (default qwen2.5:14b).
 * With no Ollama available, see examples/expected_output.md for what a run looks like.
 *
 * Usage:
 *   node examples/ask.js "what's the RTX 4070 going for?"
 *   node examples/ask.js "compare the RTX 4070 and the 4070 Ti"
 */

const { ask } = require("../src/agent/agent");

async function main() {
  const question = process.argv.slice(2).join(" ") || "what's the RTX 4070 going for?";
  console.log("Q:", question);

  const { answer, toolsUsed, warnings } = await ask(question);

  console.log("\nTools used:");
  for (const t of toolsUsed) console.log("  -", t.tool, JSON.stringify(t.params));
  if (warnings.length) {
    console.log("\nValidation warnings:");
    for (const w of warnings) console.log("  -", w);
  }
  console.log("\nA:", answer);
}

main().catch((err) => {
  console.error("Error:", err.message);
  console.error("(Is a local Ollama running? See README.md > Running.)");
  process.exit(1);
});
