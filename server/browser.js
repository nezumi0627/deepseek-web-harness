import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const DEEPSEEK_URL = "https://chat.deepseek.com/";
const DEFAULT_TIMEOUT_MS = 180_000;

export function bridgeHome() {
  return process.env.DEEPSEEK_WEB_BRIDGE_HOME || join(homedir(), ".deepseek-web-bridge");
}

function executableFromPath(names) {
  const pathEntries = (process.env.PATH || "").split(delimiter).filter(Boolean);
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const directory of pathEntries) {
    for (const name of names) {
      for (const suffix of suffixes) {
        const candidate = join(directory, `${name}${suffix}`);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

export function findChrome() {
  const configured = process.env.DEEPSEEK_WEB_CHROME;
  if (configured && existsSync(configured)) return configured;

  const platformCandidates = process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      ]
    : process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
        ]
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/usr/bin/microsoft-edge",
          "/usr/bin/microsoft-edge-stable",
          "/snap/bin/chromium"
        ];

  return platformCandidates.find(existsSync)
    || executableFromPath(["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "microsoft-edge-stable", "microsoft-edge"]);
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

async function assistantTexts(page) {
  return page.evaluate(() => {
    const reasoningSelector = [
      '.ds-think-content',
      '[data-role="reasoning"]',
      '[data-testid*="reason" i]',
      '[data-testid*="think" i]',
      '[class*="reasoning" i]',
      '[class*="thinking" i]',
      '[class*="think-content" i]',
      '.ds-reasoning',
      '.ds-think'
    ].join(', ');

    const markdown = [...document.querySelectorAll('.ds-markdown, .markdown')]
      .filter(node => !node.closest(reasoningSelector));
    if (markdown.length) {
      return [...new Set(markdown)]
        .map(node => (node.innerText || node.textContent || "").trim())
        .filter(Boolean);
    }

    const wrappers = [...document.querySelectorAll('[data-role="assistant"], [data-message-author-role="assistant"]')];
    return wrappers
      .map(node => {
        const clone = node.cloneNode(true);
        clone.querySelectorAll(reasoningSelector).forEach(child => child.remove());
        return (clone.innerText || clone.textContent || "").trim();
      })
      .filter(Boolean);
  });
}

async function reasoningTexts(page) {
  return page.evaluate(() => {
    const preferred = [...document.querySelectorAll('.ds-think-content')];
    const nodes = preferred.length ? preferred : [...document.querySelectorAll([
      '[data-role="reasoning"]',
      '[data-testid*="reason" i]',
      '[data-testid*="think" i]',
      '[class*="reasoning" i]',
      '[class*="thinking" i]',
      '[class*="think-content" i]',
      '.ds-reasoning',
      '.ds-think'
    ].join(', '))];
    return [...new Set(nodes)]
      .map(node => (node.innerText || node.textContent || "").trim())
      .filter(Boolean);
  });
}

async function waitForStableReply(page, beforeCount, beforeReasoningCount, timeoutMs) {
  const started = Date.now();
  let previous = "";
  let stableSince = 0;
  while (Date.now() - started < timeoutMs) {
    const texts = await assistantTexts(page);
    const current = texts.at(-1) || "";
    if (texts.length > beforeCount && current) {
      if (current === previous) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= 1200) {
          const reasoning = await reasoningTexts(page);
          return {
            text: current,
            thinking: reasoning.length > beforeReasoningCount ? reasoning.at(-1) || "" : ""
          };
        }
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
  const args = [
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0"
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

async function withDeepSeekPage(run) {
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
    await waitForComposer(page, 20_000);
    return await run(page);
  } finally {
    await browser?.close().catch(() => {});
    if (!chrome.killed) chrome.kill();
  }
}

export async function askWebDeepSeek(prompt, options = {}) {
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
    const beforeCount = (await assistantTexts(page)).length;
    const beforeReasoningCount = (await reasoningTexts(page)).length;
    await sendPrompt(page, input, prompt.trim());
    const result = await waitForStableReply(page, beforeCount, beforeReasoningCount, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return options.includeThink ? result : result.text;
  });
}

export async function getDeepSeekCapabilities() {
  return withDeepSeekPage(async page => {
    const bodyText = await page.locator("body").innerText();
    const fileInput = page.locator('input[type="file"]');
    const accept = await fileInput.count() ? await fileInput.last().getAttribute("accept") : null;
    return {
      platform: process.platform,
      browser: findChrome(),
      headless: /^(1|true|yes)$/i.test(process.env.DEEPSEEK_WEB_HEADLESS || ""),
      modes: {
        instant: /instant|インスタント/i.test(bodyText),
        expert: /expert|エキスパート/i.test(bodyText),
        imageRecognition: /image\s*recognition|画像認識/i.test(bodyText)
      },
      deepThink: /deep\s*think|r1|深く考える|ディープシンク|深度思考/i.test(bodyText),
      thinkingCapture: true,
      search: /search|検索|スマート検索|联网搜索/i.test(bodyText),
      fileUpload: Boolean(await fileInput.count()),
      acceptedFileTypes: accept,
      note: "Detected from the currently signed-in DeepSeek Web UI."
    };
  });
}
