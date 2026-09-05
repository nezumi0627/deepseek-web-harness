import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const DEEPSEEK_URL = "https://chat.deepseek.com/";
const DEFAULT_TIMEOUT_MS = 180_000;

export function bridgeHome() {
  return process.env.DEEPSEEK_WEB_BRIDGE_HOME || join(homedir(), ".deepseek-web-bridge");
}

export function chromeCandidates(platform = process.platform) {
  if (platform === "win32") {
    return [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    ];
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable"
  ];
}

function findBrowserOnPath() {
  const names = process.platform === "win32"
    ? ["chrome.exe", "msedge.exe"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"];
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  for (const name of names) {
    const result = spawnSync(lookup, [name], { encoding: "utf8", windowsHide: true });
    if (result.status !== 0) continue;
    const found = String(result.stdout || "").split(/\r?\n/).map(value => value.trim()).find(Boolean);
    if (found && existsSync(found)) return found;
  }
  return null;
}

export function findChrome() {
  const override = process.env.DEEPSEEK_WEB_CHROME;
  if (override && existsSync(override)) return override;
  return chromeCandidates().find(existsSync) || findBrowserOnPath();
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

async function clickControl(page, names, wanted) {
  if (wanted === undefined || wanted === null) return false;
  for (const name of names) {
    const pattern = new RegExp(name, "i");
    const candidates = [
      page.getByRole("button", { name: pattern }),
      page.getByText(pattern, { exact: false })
    ];
    for (const candidate of candidates) {
      const item = candidate.filter({ visible: true }).last();
      if (!await item.isVisible().catch(() => false)) continue;
      const pressed = await item.getAttribute("aria-pressed").catch(() => null);
      const classes = await item.getAttribute("class").catch(() => "") || "";
      const selected = pressed === "true" || /active|selected|enabled/i.test(classes);
      if (pressed === null) {
        if (wanted) await item.click();
      } else if (Boolean(wanted) !== selected) {
        await item.click();
      }
      return true;
    }
  }
  return false;
}

async function selectMode(page, mode) {
  if (!mode) return;
  const names = {
    instant: ["instant", "インスタント"],
    expert: ["expert", "エキスパート"],
    imageRecognition: ["image recognition", "画像認識"]
  }[mode];
  if (!names) throw new Error(`Unsupported DeepSeek mode: ${mode}`);
  const ok = await clickControl(page, names, true);
  if (!ok) throw new Error(`DeepSeek mode control was not found: ${mode}`);
  await page.waitForTimeout(300);
}

async function uploadFiles(page, files) {
  if (!files?.length) return;
  const paths = files.map(file => resolve(file));
  for (const file of paths) if (!existsSync(file)) throw new Error(`Attachment not found: ${file}`);

  let input = page.locator('input[type="file"]').last();
  if (!await input.count()) {
    const upload = visibleFirst(page, [
      'button[aria-label*="upload" i]',
      'button[aria-label*="attach" i]',
      'button[title*="upload" i]',
      'button[title*="attach" i]'
    ]);
    if (await upload.isVisible().catch(() => false)) await upload.click();
    input = page.locator('input[type="file"]').last();
  }
  if (!await input.count()) throw new Error("DeepSeek Web file upload control was not found.");
  await input.setInputFiles(paths);
  await page.waitForTimeout(900);
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

async function assistantReplies(page) {
  return page.evaluate(() => {
    const readText = node => (node?.innerText || node?.textContent || "").trim();
    const finalNodes = [...document.querySelectorAll(".ds-assistant-message-main-content")];
    if (finalNodes.length) {
      return finalNodes
        .map(node => {
          const wrapper = node.closest(".ds-message") || node.parentElement;
          return {
            text: readText(node),
            thinking: readText(wrapper?.querySelector(".ds-think-content")) || null
          };
        })
        .filter(reply => reply.text);
    }

    const selectors = ['[data-role="assistant"]', '[data-message-author-role="assistant"]'];
    const nodes = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))];
    return nodes.map(node => {
      const clone = node.cloneNode(true);
      clone.querySelectorAll?.(".ds-think-content").forEach(element => element.remove());
      return {
        text: readText(clone),
        thinking: readText(node.querySelector?.(".ds-think-content")) || null
      };
    }).filter(reply => reply.text);
  });
}

async function waitForStableReply(page, beforeCount, timeoutMs) {
  const started = Date.now();
  let previous = "";
  let stableSince = 0;
  while (Date.now() - started < timeoutMs) {
    const replies = await assistantReplies(page);
    const current = replies.at(-1);
    if (replies.length > beforeCount && current?.text) {
      if (current.text === previous) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 1200) return current;
      } else {
        previous = current.text;
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
  const args = [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
  ];
  if (/^(1|true|yes)$/i.test(process.env.DEEPSEEK_WEB_HEADLESS || "")) {
    args.push("--headless=new", "--window-size=1440,1200");
  } else {
    args.push("--start-maximized");
  }
  args.push(DEEPSEEK_URL);
  const chrome = spawn(executablePath, args, { stdio: "ignore" });

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

function normalizeConversationUrl(value) {
  if (!value) return DEEPSEEK_URL;
  const url = new URL(value);
  if (url.origin !== new URL(DEEPSEEK_URL).origin) throw new Error("conversationUrl must point to chat.deepseek.com");
  return url.href;
}

async function withDeepSeekPage(run, options = {}) {
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
    const targetUrl = normalizeConversationUrl(options.conversationUrl);
    if (page.url() !== targetUrl) await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForComposer(page, 20_000);
    return await run(page);
  } finally {
    await browser?.close().catch(() => {});
    if (!chrome.killed) chrome.kill();
  }
}

export async function askWebDeepSeekDetailed(prompt, options = {}) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt must be a non-empty string");
  return withDeepSeekPage(async page => {
    if (options.newChat) {
      await clickControl(page, ["new chat", "new conversation", "新しいチャット", "新規チャット"], true);
      await page.waitForTimeout(500);
    }
    const input = await waitForComposer(page, options.loginTimeoutMs ?? 20_000);
    await selectMode(page, options.mode);
    if (options.deepThink !== undefined) {
      const ok = await clickControl(page, ["deepthink", "deep think", "r1", "深く考える", "ディープシンク", "深度思考"], options.deepThink);
      if (!ok) throw new Error("DeepThink control was not found in DeepSeek Web.");
    }
    if (options.search !== undefined) {
      const ok = await clickControl(page, ["search", "web search", "検索", "スマート検索", "联网搜索"], options.search);
      if (!ok) throw new Error("Search control was not found in DeepSeek Web.");
    }
    await uploadFiles(page, options.attachments || []);
    const beforeCount = (await assistantReplies(page)).length;
    await sendPrompt(page, input, prompt.trim());
    const reply = await waitForStableReply(page, beforeCount, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return { ...reply, conversationUrl: page.url() };
  }, { conversationUrl: options.conversationUrl });
}

export async function askWebDeepSeek(prompt, options = {}) {
  return (await askWebDeepSeekDetailed(prompt, options)).text;
}

export async function getDeepSeekCapabilities() {
  return withDeepSeekPage(async page => {
    const bodyText = await page.locator("body").innerText();
    const fileInput = page.locator('input[type="file"]');
    const accept = await fileInput.count() ? await fileInput.last().getAttribute("accept") : null;
    return {
      modes: {
        instant: /instant|インスタント/i.test(bodyText),
        expert: /expert|エキスパート/i.test(bodyText),
        imageRecognition: /image\s*recognition|画像認識/i.test(bodyText)
      },
      deepThink: /deep\s*think|r1|深く考える|ディープシンク|深度思考/i.test(bodyText),
      search: /search|検索|スマート検索|联网搜索/i.test(bodyText),
      fileUpload: Boolean(await fileInput.count()),
      acceptedFileTypes: accept,
      note: "Detected from the currently signed-in DeepSeek Web UI."
    };
  });
}
