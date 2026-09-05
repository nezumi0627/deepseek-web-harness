import { strict as assert } from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "deepseek-web-harness-check", version: "0.1.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: ["server/index.js"] });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some(tool => tool.name === "ask_web_deepseek"));
  assert.ok(tools.some(tool => tool.name === "list_deepseek_skills"));
  console.log("mcp-check: ok");
} finally {
  await client.close().catch(() => {});
}
