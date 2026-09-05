import { strict as assert } from "node:assert";
import { chromeCandidates } from "./browser.js";
import { buildPrompt, listSkills } from "./skills.js";
import { buildToolAwarePrompt, parseToolCalls } from "./tool-protocol.js";
import { cleanReplyText } from "./browser.js";
import { executeLocalTool, localToolSchemas } from "./local-tools.js";
import { askWithLocalToolLoop } from "./agent.js";

assert.ok(listSkills().includes("concise"));
assert.match(buildPrompt("hello", ["concise"]), /## User request\nhello$/);
assert.ok(chromeCandidates("linux").some(path => path.includes("chromium")));
assert.ok(chromeCandidates("darwin").some(path => path.includes("Google Chrome.app")));
const tools = [{ name: "get_weather", description: "Get weather", inputSchema: { type: "object" } }];
assert.match(buildToolAwarePrompt("weather?", tools), /External tool protocol/);
assert.deepEqual(parseToolCalls('{"type":"tool_calls","calls":[{"id":"c1","name":"get_weather","arguments":{"city":"Tokyo"}}]}', tools), [
  { id: "c1", name: "get_weather", arguments: { city: "Tokyo" } }
]);
assert.equal(cleanReplyText("降雨-\n6\n。\n風−\n3。\n資訊-\n，\n如下-：\n\n## 6\n\n5\n。"), "降雨。\n風。\n資訊，\n如下：\n\n。");
assert.equal(localToolSchemas.length, 4);
assert.match(await executeLocalTool("read_file", { path: "package.json" }), /deepseek-web-harness/);
let loopTurn = 0;
const loopResult = await askWithLocalToolLoop(async () => {
  loopTurn += 1;
  return loopTurn === 1
    ? { text: '{"type":"tool_calls","calls":[{"name":"read_file","arguments":{"path":"package.json"}}]}', conversationUrl: "https://chat.deepseek.com/a/chat/s/check" }
    : { text: "tool loop ok", conversationUrl: "https://chat.deepseek.com/a/chat/s/check" };
}, "read package", { newChat: true });
assert.equal(loopResult.text, "tool loop ok");
console.log("self-check: ok");
