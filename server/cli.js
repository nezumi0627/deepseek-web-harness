import { askWebDeepSeek } from "./browser.js";
import { buildPrompt } from "./skills.js";

const args = process.argv.slice(2);
const skillIndex = args.indexOf("--skill");
const skill = skillIndex >= 0 ? args.splice(skillIndex, 2)[1] : null;
const prompt = args.join(" ").trim();
if (!prompt) {
  console.error('Usage: npm run chat -- "hello" [--skill concise]');
  process.exit(1);
}

try {
  console.log(await askWebDeepSeek(buildPrompt(prompt, skill ? [skill] : [])));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
