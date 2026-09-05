import { askWebDeepSeek } from "./browser.js";
import { runDeepSeekAgent } from "./agent.js";
import { buildPrompt } from "./skills.js";

const args = process.argv.slice(2);
const skillIndex = args.indexOf("--skill");
const skill = skillIndex >= 0 ? args.splice(skillIndex, 2)[1] : null;
const modeIndex = args.indexOf("--mode");
const mode = modeIndex >= 0 ? args.splice(modeIndex, 2)[1] : undefined;
const deepThinkIndex = args.indexOf("--deep-think");
const deepThink = deepThinkIndex >= 0 ? (args.splice(deepThinkIndex, 1), true) : undefined;
const includeThinkIndex = args.indexOf("--include-think");
const includeThink = includeThinkIndex >= 0 ? (args.splice(includeThinkIndex, 1), true) : false;
const searchIndex = args.indexOf("--search");
const search = searchIndex >= 0 ? (args.splice(searchIndex, 1), true) : undefined;
const newChatIndex = args.indexOf("--new-chat");
const newChat = newChatIndex >= 0 ? (args.splice(newChatIndex, 1), true) : false;
const toolsIndex = args.indexOf("--tools");
const useTools = toolsIndex >= 0 ? (args.splice(toolsIndex, 1), true) : false;
const maxToolCallsIndex = args.indexOf("--max-tool-calls");
const maxToolCalls = maxToolCallsIndex >= 0 ? Number(args.splice(maxToolCallsIndex, 2)[1]) : 8;
const attachments = [];
for (let i = args.length - 1; i >= 0; i--) {
  if (args[i] === "--attach" && args[i + 1]) attachments.unshift(...args.splice(i, 2).slice(1));
}
const prompt = args.join(" ").trim();
if (!prompt) {
  console.error('Usage: npm run chat -- "hello" [--skill concise] [--mode instant|expert|imageRecognition] [--deep-think] [--include-think] [--search] [--new-chat] [--tools] [--max-tool-calls 8] [--attach /path/file]');
  process.exit(1);
}

try {
  const skilledPrompt = buildPrompt(prompt, skill ? [skill] : []);
  if (useTools) {
    const result = await runDeepSeekAgent(skilledPrompt, {
      mode,
      deepThink,
      search,
      attachments,
      useTools: true,
      maxToolCalls
    });
    if (includeThink && result.thinking) console.log(`[DeepSeek thinking]\n${result.thinking}\n`);
    if (result.toolCalls.length) console.log(`[Executed MCP tools]\n${JSON.stringify(result.toolCalls, null, 2)}\n`);
    if (result.toolErrors.length) console.error(`[MCP tool errors]\n${JSON.stringify(result.toolErrors, null, 2)}\n`);
    console.log(result.text);
  } else {
    const result = await askWebDeepSeek(skilledPrompt, {
      mode,
      deepThink,
      includeThink,
      search,
      newChat,
      attachments
    });
    if (includeThink && result && typeof result === "object") {
      if (result.thinking) console.log(`[DeepSeek thinking]\n${result.thinking}\n`);
      console.log(result.text);
    } else {
      console.log(result);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
