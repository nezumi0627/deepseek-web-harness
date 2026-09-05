import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { bridgeHome, findChrome } from "./browser.js";

const executablePath = findChrome();
if (!executablePath) {
  console.error("Chrome or Edge was not found. Set DEEPSEEK_WEB_CHROME to the browser executable path.");
  process.exit(1);
}

const profile = join(bridgeHome(), "chrome-profile");
mkdirSync(profile, { recursive: true });
const child = spawn(executablePath, [
  `--user-data-dir=${profile}`,
  "--start-maximized",
  "https://chat.deepseek.com/"
], { detached: true, stdio: "ignore" });
child.unref();
console.log("DeepSeek login browser opened. Sign in normally, then close this browser before using the bridge.");
