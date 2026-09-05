import { strict as assert } from "node:assert";
import { once } from "node:events";
import { createApiServer, detectFormat } from "./api.js";

assert.equal(detectFormat({ messages: [{ role: "user", content: "hi" }] }, {}), "openai-chat");
assert.equal(detectFormat({ input: "hi" }, {}), "openai-responses");
assert.equal(detectFormat({ messages: [{ role: "user", content: "hi" }] }, { "anthropic-version": "2023-06-01" }), "anthropic");

const fakeAsk = async prompt => ({ text: prompt.includes("tool protocol") ? "unused" : "API OK", thinking: "visible thought", conversationUrl: "https://chat.deepseek.com/a/chat/s/test" });
const server = createApiServer({ ask: fakeAsk, apiKey: "test-key" });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  const health = await fetch(`${base}/health`).then(response => response.json());
  assert.equal(health.status, "ok");

  const openapi = await fetch(`${base}/openapi.json`).then(response => response.json());
  assert.ok(openapi.paths["/v1/chat/completions"]);
  assert.ok(openapi.paths["/v1/messages"]);

  const session = await fetch(`${base}/v1/sessions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-key" }, body: JSON.stringify({ title: "check" }) }).then(response => response.json());
  assert.match(session.id, /^sess_/);
  const sessionInfo = await fetch(`${base}/v1/sessions/${session.id}`, { headers: { authorization: "Bearer test-key" } }).then(response => response.json());
  assert.equal(sessionInfo.title, "check");
  const traversal = await fetch(`${base}/v1/sessions/..%2Foutside`, { headers: { authorization: "Bearer test-key" } });
  assert.equal(traversal.status, 404);

  const unauthorized = await fetch(`${base}/v1/models`);
  assert.equal(unauthorized.status, 401);

  const openai = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-key" },
    body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "hello" }] })
  }).then(response => response.json());
  assert.equal(openai.object, "chat.completion");
  assert.equal(openai.choices[0].message.content, "API OK");
  assert.match(openai.deepseek_web.session_id, /^sess_/);
  assert.ok(openai.usage.total_tokens > 0);

  const anthropic = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "test-key", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "deepseek-chat", max_tokens: 128, messages: [{ role: "user", content: "hello" }] })
  }).then(response => response.json());
  assert.equal(anthropic.type, "message");
  assert.equal(anthropic.content[0].text, "API OK");
  assert.ok(anthropic.usage.input_tokens > 0);

  const trajectory = await fetch(`${base}/v1/sessions/${openai.deepseek_web.session_id}/trajectory`, { headers: { authorization: "Bearer test-key" } }).then(response => response.json());
  assert.ok(trajectory.data.some(event => event.type === "response"));

  const auto = await fetch(`${base}/v1/auto`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-key" },
    body: JSON.stringify({ input: "hello", model: "deepseek-web" })
  }).then(response => response.json());
  assert.equal(auto.object, "response");

  console.log("api-check: ok");
} finally {
  server.close();
  await once(server, "close");
}
