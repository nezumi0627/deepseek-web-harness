import { strict as assert } from "node:assert";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { callMcpTool, closeMcpClients, formatMcpToolResult, listMcpTools } from "./mcp-tools.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(root, "server", "fixture-mcp.js");
const configPath = join(tmpdir(), `deepseek-web-harness-mcp-${process.pid}.json`);
const previousConfig = process.env.DEEPSEEK_WEB_MCP_CONFIG;

writeFileSync(configPath, JSON.stringify({
  mcpServers: {
    fixture: {
      command: process.execPath,
      args: [fixture],
      cwd: root,
      env: {}
    }
  }
}, null, 2));
process.env.DEEPSEEK_WEB_MCP_CONFIG = configPath;

try {
  const listed = await listMcpTools();
  assert.deepEqual(listed.errors, []);
  assert.ok(listed.tools.some(tool => tool.name === "fixture/echo"));

  const result = await callMcpTool("fixture/echo", { text: "portable" });
  assert.equal(formatMcpToolResult(result), "echo:portable");
  console.log("mcp-tools-check: ok");
} finally {
  await closeMcpClients();
  if (previousConfig === undefined) delete process.env.DEEPSEEK_WEB_MCP_CONFIG;
  else process.env.DEEPSEEK_WEB_MCP_CONFIG = previousConfig;
  rmSync(configPath, { force: true });
}
