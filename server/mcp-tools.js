import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = join(ROOT, "deepseek.mcp.json");
const clients = new Map();

export function mcpConfigPath() {
  return resolve(process.env.DEEPSEEK_WEB_MCP_CONFIG || DEFAULT_CONFIG);
}

export function loadMcpConfig() {
  const path = mcpConfigPath();
  if (!existsSync(path)) return { path, mcpServers: {} };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return { path, mcpServers: parsed?.mcpServers || {} };
}

function cleanEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries({ ...process.env, ...extra })) {
    if (value !== undefined && value !== null) env[key] = String(value);
  }
  return env;
}

async function getClient(serverName) {
  if (clients.has(serverName)) return clients.get(serverName);
  const { mcpServers } = loadMcpConfig();
  const config = mcpServers[serverName];
  if (!config?.command) throw new Error(`Unknown MCP server: ${serverName}`);

  const cwd = config.cwd
    ? (isAbsolute(config.cwd) ? config.cwd : resolve(ROOT, config.cwd))
    : ROOT;
  const client = new Client({ name: `deepseek-web-harness:${serverName}`, version: "0.3.0" });
  const transport = new StdioClientTransport({
    command: config.command,
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    cwd,
    env: cleanEnv(config.env)
  });
  await client.connect(transport);
  clients.set(serverName, client);
  return client;
}

export async function listMcpTools() {
  const { path, mcpServers } = loadMcpConfig();
  const tools = [];
  const errors = [];
  for (const serverName of Object.keys(mcpServers)) {
    try {
      const client = await getClient(serverName);
      const result = await client.listTools();
      for (const tool of result.tools || []) {
        tools.push({
          name: `${serverName}/${tool.name}`,
          server: serverName,
          tool: tool.name,
          description: tool.description || "",
          inputSchema: tool.inputSchema || { type: "object", properties: {} }
        });
      }
    } catch (error) {
      errors.push({ server: serverName, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { configPath: path, tools, errors };
}

export async function callMcpTool(qualifiedName, args = {}) {
  const slash = qualifiedName.indexOf("/");
  if (slash <= 0) throw new Error(`Tool name must be server/tool, got: ${qualifiedName}`);
  const serverName = qualifiedName.slice(0, slash);
  const toolName = qualifiedName.slice(slash + 1);
  const client = await getClient(serverName);
  const result = await client.callTool({ name: toolName, arguments: args || {} });
  return result;
}

export function formatMcpToolResult(result) {
  const parts = [];
  for (const item of result?.content || []) {
    if (item?.type === "text") parts.push(item.text || "");
    else parts.push(JSON.stringify(item));
  }
  if (!parts.length) return JSON.stringify(result ?? null);
  return parts.join("\n\n");
}
