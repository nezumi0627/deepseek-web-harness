import { askWebDeepSeekDetailed } from "./browser.js";
import { buildPrompt, forceLanguage } from "./skills.js";
import { askWithLocalToolLoop } from "./agent.js";

const args = process.argv.slice(2);
const skillIndex = args.indexOf("--skill");
const skill = skillIndex >= 0 ? args.splice(skillIndex, 2)[1] : null;
const modeIndex = args.indexOf("--mode");
const mode = modeIndex >= 0 ? args.splice(modeIndex, 2)[1] : undefined;
const deepThinkIndex = args.indexOf("--deep-think");
const deepThink = deepThinkIndex >= 0 ? (args.splice(deepThinkIndex, 1), true) : undefined;
const searchIndex = args.indexOf("--search");
const search = searchIndex >= 0 ? (args.splice(searchIndex, 1), true) : undefined;
const newChatIndex = args.indexOf("--new-chat");
const newChat = newChatIndex >= 0 ? (args.splice(newChatIndex, 1), true) : false;
const showThinkingIndex = args.indexOf("--show-thinking");
const showThinking = showThinkingIndex >= 0 ? (args.splice(showThinkingIndex, 1), true) : false;
const thinkingTagIndex = args.indexOf("--thinking-tag");
const thinkingTag = thinkingTagIndex >= 0 ? (args.splice(thinkingTagIndex, 1), true) : false;
const toolsIndex = args.indexOf("--tools");
const useTools = toolsIndex >= 0 ? (args.splice(toolsIndex, 1), true) : false;
const languageIndex = args.indexOf("--language");
const language = languageIndex >= 0 ? args.splice(languageIndex, 2)[1] : undefined;
const attachments = [];
for (let i = args.length - 1; i >= 0; i--) {
  if (args[i] === "--attach" && args[i + 1]) attachments.unshift(...args.splice(i, 2).slice(1));
}
const prompt = args.join(" ").trim();
if (!prompt) {
  console.error('Usage: npm run chat -- "hello" [--skill concise] [--mode instant|expert|imageRecognition] [--deep-think] [--show-thinking] [--search] [--new-chat] [--attach /path/file]');
  process.exit(1);
}

try {
  const options = { mode, deepThink, search, newChat, attachments };
  const preparedPrompt = forceLanguage(buildPrompt(prompt, skill ? [skill] : []), language);
  const result = useTools ? await askWithLocalToolLoop(askWebDeepSeekDetailed, preparedPrompt, options) : await askWebDeepSeekDetailed(preparedPrompt, options);
  if (showThinking && result.thinking) console.log(`${thinkingTag ? `<think>\n${result.thinking}\n</think>` : `[thinking]\n${result.thinking}\n[/thinking]`}\n`);
  console.log(result.text);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
