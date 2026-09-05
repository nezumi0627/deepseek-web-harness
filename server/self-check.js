import { strict as assert } from "node:assert";
import { chromeCandidates } from "./browser.js";
import { buildPrompt, listSkills } from "./skills.js";
import { buildToolAwarePrompt, parseToolCalls } from "./tool-protocol.js";

assert.ok(listSkills().includes("concise"));
assert.match(buildPrompt("hello", ["concise"]), /## User request\nhello$/);
assert.ok(chromeCandidates("linux").some(path => path.includes("chromium")));
assert.ok(chromeCandidates("darwin").some(path => path.includes("Google Chrome.app")));
const tools = [{ name: "get_weather", description: "Get weather", inputSchema: { type: "object" } }];
assert.match(buildToolAwarePrompt("weather?", tools), /External tool protocol/);
assert.deepEqual(parseToolCalls('{"type":"tool_calls","calls":[{"id":"c1","name":"get_weather","arguments":{"city":"Tokyo"}}]}', tools), [
  { id: "c1", name: "get_weather", arguments: { city: "Tokyo" } }
]);
console.log("self-check: ok");
