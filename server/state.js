import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const root = () => process.env.DEEPSEEK_WEB_STATE_DIR || join(homedir(), ".deepseek-web-bridge", "state");
const sessionsDir = () => join(root(), "sessions");
const trajectoryDir = () => join(root(), "trajectories");
function ensure() { mkdirSync(sessionsDir(), { recursive: true }); mkdirSync(trajectoryDir(), { recursive: true }); }
function validId(id) { return typeof id === "string" && /^sess_[0-9a-f-]{36}$/i.test(id); }
function file(id) { return validId(id) ? join(sessionsDir(), `${id}.json`) : null; }
function read(id) { try { return JSON.parse(readFileSync(file(id), "utf8")); } catch { return null; } }
function write(session) { ensure(); writeFileSync(file(session.id), JSON.stringify(session, null, 2)); return session; }

export function createSession({ title = "New DeepSeek chat", conversationUrl = null, parentId = null } = {}) {
  const now = new Date().toISOString();
  return write({ id: `sess_${randomUUID()}`, title, conversationUrl, parentId, createdAt: now, updatedAt: now, messages: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, compressed: false });
}
export function getSession(id) { return read(id); }
export function listSessions() { ensure(); return readdirSync(sessionsDir()).filter(x => x.endsWith(".json")).map(x => read(x.slice(0, -5))).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function updateSession(session) { return write({ ...session, updatedAt: new Date().toISOString() }); }
export function deleteSession(id) { if (!read(id)) return false; rmSync(file(id), { force: true }); return true; }
export function appendTrajectory(sessionId, event) { if (!validId(sessionId)) throw new Error("Invalid session id."); ensure(); appendFileSync(join(trajectoryDir(), `${sessionId}.jsonl`), JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n"); }
export function readTrajectory(sessionId) { if (!validId(sessionId)) return []; const path = join(trajectoryDir(), `${sessionId}.jsonl`); return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []; }
export function estimateTokens(value) { return Math.max(0, Math.ceil(String(value ?? "").length / 4)); }
export function compactSession(session, limit = 12000) {
  const text = session.messages.map(m => `${m.role}: ${m.content}`).join("\n");
  if (text.length <= limit) return { session, compacted: false };
  const keep = session.messages.slice(-6);
  const summary = text.slice(0, 2500);
  const next = updateSession({ ...session, messages: [{ role: "system", content: `[context summary]\n${summary}` }, ...keep], compressed: true });
  appendTrajectory(session.id, { type: "context_compaction", keptMessages: keep.length });
  return { session: next, compacted: true };
}
