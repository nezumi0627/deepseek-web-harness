import { strict as assert } from "node:assert";
import { buildPrompt, listSkills } from "./skills.js";
import { buildToolPrompt, parseToolCalls } from "./tools.js";

assert.ok(listSkills().includes("concise"));
assert.match(buildPrompt("hello", ["concise"]), /## User request\nhello$/);

const toolPrompt = buildToolPrompt("use a tool", [{
  name: "calculator",
  description: "Do arithmetic",
  inputSchema: { type: "object" }
}], []);
assert.match(toolPrompt, /<tool_call>/);
assert.match(toolPrompt, /calculator/);

const parsed = parseToolCalls('before <tool_call>{"name":"calculator","arguments":{"x":1}}</tool_call>');
assert.equal(parsed.answer, "before");
assert.deepEqual(parsed.toolCalls, [{ name: "calculator", arguments: { x: 1 } }]);

console.log("self-check: ok");
