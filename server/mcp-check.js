import { strict as assert } from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "deepseek-web-harness-check", version: "0.3.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: ["server/index.js"] });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();

  const askTool = tools.find(tool => tool.name === "ask_web_deepseek");
  assert.ok(askTool);
  for (const field of [
    "prompt",
    "skills",
    "mode",
    "deepThink",
    "includeThink",
    "search",
    "newChat",
    "attachments",
    "tools",
    "toolResults"
  ]) {
    assert.ok(askTool.inputSchema?.properties?.[field], `ask_web_deepseek is missing ${field}`);
  }

  const agentTool = tools.find(tool => tool.name === "ask_web_deepseek_agent");
  assert.ok(agentTool);
  for (const field of [
    "prompt",
    "skills",
    "mode",
    "deepThink",
    "includeThink",
    "search",
    "attachments",
    "useTools",
    "maxToolCalls"
  ]) {
    assert.ok(agentTool.inputSchema?.properties?.[field], `ask_web_deepseek_agent is missing ${field}`);
  }

  assert.ok(tools.some(tool => tool.name === "deepseek_web_capabilities"));
  assert.ok(tools.some(tool => tool.name === "list_deepseek_skills"));
  assert.ok(tools.some(tool => tool.name === "list_deepseek_mcp_tools"));
  console.log("mcp-check: ok");
} finally {
  await client.close().catch(() => {});
}
