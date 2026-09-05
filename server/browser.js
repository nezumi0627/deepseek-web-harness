import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const DEEPSEEK_URL = "https://chat.deepseek.com/";
const DEFAULT_TIMEOUT_MS = 180_000;

export function bridgeHome() {
  return process.env.DEEPSEEK_WEB_BRIDGE_HOME || join(homedir(), ".deepseek-web-bridge");
}

export function findChrome() {
  const candidates = [
    process.env.DEEPSEEK_WEB_CHROME,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  return candidates.find(existsSync) || null;
}

function visibleFirst(page, selectors) {
  return page.locator(selectors.join(", ")).filter({ visible: true }).last();
}

function composer(page) {
  return visibleFirst(page, [
    "textarea#chat-input",
    "textarea[placeholder]",
    '[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]'
  ]);
}

async function waitForComposer(page, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const input = composer(page);
    if (await input.isVisible().catch(() => false)) return input;
    await page.waitForTimeout(400);
  }
  throw new Error(`DeepSeek Web composer was not found at ${page.url()}. Run npm run login, sign in, close that browser, then retry.`);
}

async function sendPrompt(page, input, prompt) {
  const tag = await input.evaluate(el => el.tagName.toLowerCase());
  if (tag === "textarea" || tag === "input") await input.fill(prompt);
  else {
    await input.click();
    await page.keyboard.insertText(prompt);
  }

  const send = visibleFirst(page, [
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'button[aria-label*="送信"]'
  ]);
  if (await send.count()) await send.click();
  else await input.press("Enter");
}

async function assistantTexts(page) {
  return page.evaluate(() => {
    const selectors = [
      '[data-role="assistant"]',
      '[data-message-author-role="assistant"]',
      '.ds-markdown',
      '.markdown'
    ];
    const nodes = selectors.flatMap(selector => [...document.querySelectorAll(selector)]);
    return [...new Set(nodes)]
      .map(node => (node.innerText || node.textContent || "").trim())
      .filter(Boolean);
  });
}

async function waitForStableReply(page, beforeCount, timeoutMs) {
  const started = Date.now();
  let previous = "";
  let stableSince = 0;
  while (Date.now() - started < timeoutMs) {
    const texts = await assistantTexts(page);
    const current = texts.at(-1) || "";
    if (texts.length > beforeCount && current) {
      if (current === previous) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 1200) return current;
      } else {
        previous = current;
        stableSince = 0;
      }
    }
    await page.waitForTimeout(350);
  }
  throw new Error("Timed out waiting for DeepSeek Web to finish its response.");
}

async function startDebugChrome(executablePath, profile) {
  const devToolsFile = join(profile, "DevToolsActivePort");
  rmSync(devToolsFile, { force: true });
  const chrome = spawn(executablePath, [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "--start-maximized",
    DEEPSEEK_URL
  ], { stdio: "ignore" });

  const started = Date.now();
  while (Date.now() - started < 15_000) {
    if (existsSync(devToolsFile)) {
      const [value] = readFileSync(devToolsFile, "utf8").split(/\r?\n/);
      if (/^\d+$/.test(value || "")) return { chrome, port: Number(value) };
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  chrome.kill();
  throw new Error("Chrome debugging endpoint did not become ready. Close the DeepSeek login browser and retry.");
}

export async function askWebDeepSeek(prompt, options = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt must be a non-empty string");
  const executablePath = findChrome();
  if (!executablePath) throw new Error("Chrome or Edge was not found. Set DEEPSEEK_WEB_CHROME to the browser executable path.");

  const profile = join(bridgeHome(), "chrome-profile");
  mkdirSync(profile, { recursive: true });
  const { chrome, port } = await startDebugChrome(executablePath, profile);
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Chrome opened without an accessible browser context.");
    const page = context.pages().find(candidate => candidate.url().includes("deepseek.com")) || context.pages()[0] || await context.newPage();
    if (!page.url().includes("deepseek.com")) await page.goto(DEEPSEEK_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const input = await waitForComposer(page, options.loginTimeoutMs ?? 20_000);
    const beforeCount = (await assistantTexts(page)).length;
    await sendPrompt(page, input, prompt.trim());
    return await waitForStableReply(page, beforeCount, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } finally {
    await browser?.close().catch(() => {});
    if (!chrome.killed) chrome.kill();
  }
}
