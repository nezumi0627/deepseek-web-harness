import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { askWebDeepSeekDetailed } from "./browser.js";
import { autoSelectSkills, buildPrompt } from "./skills.js";
import { appendTrajectory, compactSession, createSession, estimateTokens, getSession, listSessions, updateSession } from "./state.js";

const rl = createInterface({ input, output });
let session = createSession({ title: "Harness chat" });
let settings = { mode: undefined, deepThink: undefined, search: undefined, skills: [], attachments: [], stream: false, includeThinking: true };

function showHelp() {
  console.log("/new [title]  /sessions  /use <id>  /rename <title>  /fork  /compact  /attach <path>  /skill <name>  /mode <instant|expert|imageRecognition>  /think  /search  /stream  /clear-attach  /quit");
}
function showStatus() {
  console.log(`session=${session.id} title=${session.title} messages=${session.messages.length} tokens≈${session.usage.totalTokens} mode=${settings.mode || "default"} stream=${settings.stream ? "on" : "off"}`);
}
async function command(line) {
  const [name, ...parts] = line.slice(1).split(" ");
  const value = parts.join(" ").trim();
  if (name === "help") showHelp();
  else if (name === "status") showStatus();
  else if (name === "new") { session = createSession({ title: value || "Harness chat" }); console.log(`created ${session.id}`); }
  else if (name === "sessions") listSessions().forEach(item => console.log(`${item.id}  ${item.title}  ${item.messages.length} messages  tokens≈${item.usage.totalTokens}`));
  else if (name === "use") { const found = getSession(parts[0]); if (!found) console.log("session not found"); else { session = found; console.log(`using ${session.id}`); } }
  else if (name === "rename") { if (value) { session = updateSession({ ...session, title: value }); console.log("renamed"); } }
  else if (name === "fork") { session = createSession({ title: `${session.title} (fork)`, parentId: session.id }); console.log(`forked ${session.id}`); }
  else if (name === "compact") { session = compactSession(session).session; console.log("context compacted"); }
  else if (name === "attach") { settings.attachments.push(value); console.log(`attachments=${settings.attachments.length}`); }
  else if (name === "clear-attach") settings.attachments = [];
  else if (name === "skill") { settings.skills = value ? value.split(",").map(x => x.trim()).filter(Boolean) : []; console.log(`skills=${settings.skills.join(", ") || "auto"}`); }
  else if (name === "mode") settings.mode = value || undefined;
  else if (name === "think") settings.deepThink = !settings.deepThink;
  else if (name === "search") settings.search = !settings.search;
  else if (name === "stream") settings.stream = !settings.stream;
  else if (name === "quit" || name === "exit") return false;
  else console.log("unknown command; use /help");
  return true;
}

async function answer(prompt) {
  const skills = settings.skills.length ? settings.skills : autoSelectSkills(prompt);
  const started = performance.now();
  const fullPrompt = buildPrompt(prompt, skills);
  appendTrajectory(session.id, { type: "harness_request", prompt, skills, attachments: settings.attachments });
  const result = await askWebDeepSeekDetailed(fullPrompt, { ...settings, newChat: !session.conversationUrl, conversationUrl: session.conversationUrl });
  const elapsed = Math.max(1, performance.now() - started);
  const inputTokens = estimateTokens(fullPrompt);
  const outputTokens = estimateTokens(result.text);
  session = updateSession({ ...session, conversationUrl: result.conversationUrl, messages: [...session.messages, { role: "user", content: prompt }, { role: "assistant", content: result.text }], usage: { inputTokens: session.usage.inputTokens + inputTokens, outputTokens: session.usage.outputTokens + outputTokens, totalTokens: session.usage.totalTokens + inputTokens + outputTokens } });
  appendTrajectory(session.id, { type: "harness_response", text: result.text, thinking: result.thinking || null, usage: { inputTokens, outputTokens }, elapsedMs: elapsed });
  if (settings.includeThinking && result.thinking) console.log(`\n[thinking]\n${result.thinking}\n[/thinking]`);
  if (settings.stream) {
    for (const chunk of result.text.match(/.{1,24}/gs) || []) { output.write(chunk); await new Promise(resolve => setTimeout(resolve, 12)); }
    console.log();
  } else console.log(`\n${result.text}`);
  console.log(`\n[${(elapsed / 1000).toFixed(1)}s | ${(result.text.length / (elapsed / 1000)).toFixed(1)} chars/s | input≈${inputTokens} output≈${outputTokens} total≈${session.usage.totalTokens}]`);
}

console.log("DeepSeek Web Harness (buffered browser stream; /help for commands)");
showStatus();
while (true) {
  let line;
  try { line = (await rl.question("\nYou> ")).trim(); } catch { break; }
  if (!line) continue;
  if (line.startsWith("/")) { if (!await command(line)) break; continue; }
  try { await answer(line); } catch (error) { console.error(`[DeepSeek error] ${error instanceof Error ? error.message : String(error)}`); appendTrajectory(session.id, { type: "harness_error", message: String(error) }); }
}
rl.close();
