import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, relative, resolve } from "node:path";

const exec = promisify(execFile);
const root = () => resolve(process.env.DEEPSEEK_WEB_TOOL_ROOT || process.cwd());
function safePath(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("path is required");
  const target = resolve(root(), value);
  if (relative(root(), target).startsWith("..") || isAbsolute(relative(root(), target))) throw new Error("path is outside DEEPSEEK_WEB_TOOL_ROOT");
  return target;
}
export const localToolSchemas = [
  { name: "read_file", description: "Read a UTF-8 text file under the configured tool root.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "write_file", description: "Write UTF-8 text to a file under the configured tool root.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "list_files", description: "List entries in a directory under the configured tool root.", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
  { name: "run_check", description: "Run a safe project check: npm test, npm run check, or npm run typecheck.", inputSchema: { type: "object", properties: { command: { type: "string", enum: ["npm test", "npm run check", "npm run typecheck"] } }, required: ["command"] } }
];
export async function executeLocalTool(name, args = {}) {
  if (name === "read_file") return readFileSync(safePath(args.path), "utf8");
  if (name === "write_file") { const path = safePath(args.path); writeFileSync(path, String(args.content ?? "")); return `wrote ${path}`; }
  if (name === "list_files") return readdirSync(safePath(args.path || "."), { withFileTypes: true }).map(entry => `${entry.isDirectory() ? "dir" : "file"}: ${entry.name}`);
  if (name === "run_check") {
    const [file, ...argv] = String(args.command || "").split(" ");
    if (!['npm test', 'npm run check', 'npm run typecheck'].includes(args.command)) throw new Error("unsupported check command");
    try { const result = await exec(file, argv, { cwd: root(), timeout: 120_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }); return `${result.stdout}${result.stderr}`.slice(-20_000); }
    catch (error) { return `check failed: ${error.stdout || ""}${error.stderr || error.message}`.slice(-20_000); }
  }
  throw new Error(`unknown local tool: ${name}`);
}
