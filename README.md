# DeepSeek Web Harness

Use an authenticated DeepSeek Web session as a local MCP tool from MCP-capable AI harnesses and third-party clients.

```text
MCP client / harness
        |
        v
 deepseek-web-harness
   |      |      |
 Skills  MCP    Media
   |     tools    |
        v
 signed-in Chrome / Chromium / Edge
        |
        v
    DeepSeek Web
 DeepThink / Search / Vision
        |
        v
answer + visible thinking + executed tool calls
```

The first login is manual in a normal installed browser. The bridge then reuses that dedicated profile. It does not copy cookies or credentials into the repository.

## Supported platforms

- Windows 10/11
- Linux, including Ubuntu
- macOS

The bridge auto-detects common Chrome, Chromium, and Microsoft Edge locations and searches `PATH`. Override detection with `DEEPSEEK_WEB_CHROME=/absolute/path/to/browser`.

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

## MCP server

Start the stdio server:

```bash
npm run mcp
```

Generic client config:

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

On Windows, a path such as `E:/projects/deepseek-web-harness/server/index.js` works too.

Exposed MCP tools:

- `ask_web_deepseek` — normal DeepSeek Web chat with skills, modes, DeepThink, reasoning capture, search, attachments, and caller-managed tool calls.
- `ask_web_deepseek_agent` — DeepSeek Web agent loop that automatically executes configured MCP tools.
- `deepseek_web_capabilities` — live browser/UI/platform/headless/upload capability inspection.
- `list_deepseek_skills` — local `SKILL.md` discovery.
- `list_deepseek_mcp_tools` — list host MCP tools available to the automatic agent loop.

`ask_web_deepseek` returns MCP text plus `structuredContent` containing `answer`, `thinking`, and `toolCalls`. `thinking` is populated when `includeThink=true` and the visible DeepThink/reasoning DOM can be read from the current page.

## Automatic MCP tool calling

DeepSeek Web does not expose a native function-calling API, so the bridge implements a bounded host-side tool loop:

1. The bridge lists configured MCP tools.
2. Their schemas are given to DeepSeek.
3. DeepSeek requests one using `<tool_call>{...}</tool_call>`.
4. The bridge executes that real MCP tool.
5. The tool result is sent back to DeepSeek.
6. DeepSeek may call another tool or return the final answer.

Create `deepseek.mcp.json` next to `package.json` using `deepseek.mcp.example.json` as a template:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "node",
      "args": ["/absolute/path/to/filesystem-mcp-server.js"],
      "cwd": ".",
      "env": {}
    }
  }
}
```

`deepseek.mcp.json` is ignored by Git because it may contain local paths or environment values. You can keep the file elsewhere with `DEEPSEEK_WEB_MCP_CONFIG=/absolute/path/config.json`.

Run the automatic agent loop from CLI:

```bash
npm run chat -- "Inspect the project and tell me what is broken" --tools --deep-think --include-think
```

Limit tool recursion if needed:

```bash
npm run chat -- "Do the task" --tools --max-tool-calls 4
```

From another MCP client, call `ask_web_deepseek_agent` with for example:

```json
{
  "prompt": "Inspect the files and summarize the project",
  "skills": ["concise"],
  "deepThink": true,
  "includeThink": true,
  "useTools": true,
  "maxToolCalls": 8
}
```

The result includes the final answer, captured visible thinking, every executed MCP tool call, and MCP connection errors if any.

## Caller-managed tool calling

`ask_web_deepseek` also supports caller-supplied tool definitions through `tools` and accepts prior results through `toolResults`. This is useful when the outer harness wants to own execution itself. The automatic `ask_web_deepseek_agent` path is simpler when you want this project to execute configured MCP tools directly.

## Skills

Skills live at `skills/<name>/SKILL.md` and are prepended to the DeepSeek prompt. List them with `list_deepseek_skills`, then pass names such as:

```json
{
  "skills": ["concise"]
}
```

Skills work in both normal chat and the automatic MCP tool agent.

## DeepSeek Web features

The bridge currently maps the visible Web controls for:

- Instant
- Expert
- Image Recognition
- DeepThink
- Smart Search
- New chat
- File/media upload
- Visible DeepThink/reasoning capture

The live upload input currently advertises common images (`png`, `jpg`, `webp`, `gif`, `svg`), PDF, Office documents, spreadsheets, text/Markdown/CSV/JSON, source code, and many additional formats. Use `deepseek_web_capabilities` to inspect the current `accept` list instead of hard-coding it in clients.

CLI examples:

```bash
npm run chat -- "Explain this carefully" --mode expert --deep-think --include-think --new-chat
npm run chat -- "What is in this file?" --mode imageRecognition --attach /absolute/path/image.png --new-chat
npm run chat -- "Find the latest information about this topic" --search --new-chat
npm run chat -- "Use tools to inspect this project" --tools --deep-think --include-think
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
