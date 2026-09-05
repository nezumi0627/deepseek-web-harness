# DeepSeek Web Harness

Use an authenticated DeepSeek Web session as a local MCP tool from MCP-capable AI harnesses and third-party clients.

```text
MCP-capable harness / third-party client
              |
              v
      deepseek-web-harness
        |      |      |
     Skills  Tools  Media
        |      |      |
              v
  signed-in Chrome/Edge profile
              |
              v
        DeepSeek Web
   DeepThink / Search / Vision
              |
              v
 answer + thinking + toolCalls
```

The first login is manual in a normal installed Chrome/Edge/Chromium window. The bridge then reuses that dedicated browser profile. It does not copy cookies or credentials into the repository.

## Supported platforms

- Windows 10/11
- Linux, including Ubuntu
- macOS

The bridge auto-detects common Chrome, Chromium, and Microsoft Edge locations on all three platforms and also searches `PATH`. Override detection with `DEEPSEEK_WEB_CHROME=/absolute/path/to/browser`.

## Setup

```bash
npm install
npm run login
```

Sign in to DeepSeek in the browser that opens, then close that browser normally.

Verify direct chat:

```bash
npm run chat -- "Reply with exactly: DEEPSEEK WEB READY" --new-chat
```

DeepThink with visible reasoning when the current DeepSeek Web DOM exposes it:

```bash
npm run chat -- "Solve this carefully" --deep-think --include-think --new-chat
```

## Headless mode

After the one-time manual login, the same profile can be reused without showing a browser window.

PowerShell:

```powershell
$env:DEEPSEEK_WEB_HEADLESS="1"
npm run chat -- "hello" --new-chat
```

Linux / Ubuntu / macOS:

```bash
export DEEPSEEK_WEB_HEADLESS=1
npm run chat -- "hello" --new-chat
```

## MCP

Start the MCP stdio server:

```bash
npm run mcp
```

Generic MCP config:

```json
{
  "mcpServers": {
    "deepseek-web": {
      "command": "node",
      "args": ["/absolute/path/deepseek-web-harness/server/index.js"]
    }
  }
}
```

On Windows, an absolute path such as `E:/projects/deepseek-web-harness/server/index.js` also works.

MCP tools:

- `ask_web_deepseek` — DeepSeek Web chat with `skills`, `mode`, `deepThink`, `includeThink`, `search`, `newChat`, `attachments`, `tools`, and `toolResults`.
- `deepseek_web_capabilities` — live UI/browser/platform/headless/upload capability inspection.
- `list_deepseek_skills` — local `SKILL.md` discovery.

`ask_web_deepseek` returns normal MCP text plus `structuredContent`:

```json
{
  "answer": "...",
  "thinking": "...",
  "toolCalls": [
    {
      "name": "calculator",
      "arguments": { "expression": "12*34" }
    }
  ]
}
```

`thinking` is populated only when `includeThink=true` and DeepSeek Web exposes the DeepThink/reasoning content in the current page DOM. DeepSeek can change its UI, so this is intentionally selector-based rather than relying on private APIs.

## Tool calling

The bridge uses a portable tool-call protocol so an MCP client or another AI harness can execute its own tools without giving this browser bridge direct access to them.

1. The caller passes tool definitions in `tools`.
2. DeepSeek requests a tool as `<tool_call>{...}</tool_call>`.
3. The bridge parses that into `structuredContent.toolCalls`.
4. The caller executes the requested tool.
5. The caller invokes `ask_web_deepseek` again with the result in `toolResults`.
6. DeepSeek continues and may request another tool or return the final answer.

Example tool definition:

```json
{
  "name": "calculator",
  "description": "Evaluate arithmetic",
  "inputSchema": {
    "type": "object",
    "properties": {
      "expression": { "type": "string" }
    },
    "required": ["expression"]
  }
}
```

Example tool result:

```json
{
  "name": "calculator",
  "result": "408"
}
```

This works with MCP clients and third-party harnesses that can read `toolCalls`, execute their own tool, and feed back `toolResults`.

## Skills

Skills live at `skills/<name>/SKILL.md` and are prepended to the DeepSeek prompt. List them through `list_deepseek_skills`, then pass names such as:

```json
{
  "skills": ["concise"]
}
```

## DeepSeek Web features

The bridge currently maps the visible Web controls for:

- Instant
- Expert
- Image Recognition
- DeepThink
- Smart Search
- New chat
- File/media upload

The live upload input currently advertises common images (`png`, `jpg`, `webp`, `gif`, `svg`), PDF, Office documents, spreadsheets, text/Markdown/CSV/JSON, source code, and many additional formats. Use `deepseek_web_capabilities` to inspect the current `accept` list instead of hard-coding it in clients.

CLI examples:

```bash
npm run chat -- "Explain this carefully" --mode expert --deep-think --include-think --new-chat
npm run chat -- "What is in this file?" --mode imageRecognition --attach /absolute/path/image.png --new-chat
npm run chat -- "Find the latest information about this topic" --search --new-chat
```

## Credits

Inspired by [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web), especially its local bridge -> owned browser session -> web AI response pattern. This project is a separate DeepSeek-oriented implementation.

## Notes

- Chrome, Chromium, or Edge must be installed.
- If browser auto-detection fails, set `DEEPSEEK_WEB_CHROME` to the executable path.
- If the site asks for verification or login again, run `npm run login` and complete it manually.
- Browser/site UI changes can require selector updates, especially reasoning capture.
- The bridge does not bypass login, verification, Cloudflare, or other access controls.

MIT licensed.
