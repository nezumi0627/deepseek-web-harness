import { askWebDeepSeek } from "./browser.js";
import { buildPrompt } from "./skills.js";

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
const attachments = [];
for (let i = args.length - 1; i >= 0; i--) {
  if (args[i] === "--attach" && args[i + 1]) attachments.unshift(...args.splice(i, 2).slice(1));
}
const prompt = args.join(" ").trim();
if (!prompt) {
  console.error('Usage: npm run chat -- "hello" [--skill concise] [--mode instant|expert|imageRecognition] [--deep-think] [--search] [--new-chat] [--attach C:\\path\\file]');
  process.exit(1);
}

try {
  console.log(await askWebDeepSeek(buildPrompt(prompt, skill ? [skill] : []), { mode, deepThink, search, newChat, attachments }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
