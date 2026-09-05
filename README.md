# DeepSeek Web Harness

Use an authenticated DeepSeek Web session as a local MCP tool from MCP-capable AI harnesses and third-party clients.

Step 1 flow:

```text
MCP-capable harness / third-party client
              |
              v
      deepseek-web-harness
              |
      local SKILL.md injection
              |
              v
  signed-in normal Chrome profile
              |
              v
        DeepSeek Web
              |
              v
          response
```

The first login is manual in a normal installed Chrome/Edge/Chromium window. The bridge then reuses that dedicated browser profile. It does not copy cookies or credentials into the repository.

## Setup

```sh
npm install
npm run login
```

Sign in to DeepSeek in the browser that opens, then close that browser normally.

Verify direct chat:

```sh
npm run chat -- "Reply with exactly: DEEPSEEK WEB READY"
```

Start the MCP server:

```sh
npm run mcp
```

Generic MCP stdio config:

```json
{
  "mcpServers": {
    "deepseek-web": {
      "command": "node",
      "args": ["E:/projects/deepseek-web-harness/server/index.js"]
    }
  }
}
```

Tools:

- `ask_web_deepseek` — prompt DeepSeek Web and return structured `{ text, thinking, toolCalls, conversationUrl }`. Supports `mode` (`instant`, `expert`, `imageRecognition`), `deepThink`, `search`, `newChat`, `attachments`, local `skills`, and host tool schemas/results.
- `deepseek_web_capabilities` — inspect the signed-in Web UI for DeepThink, search, and file-upload support.
- `list_deepseek_skills` — list local skills.

`ask_web_deepseek` accepts `skills`, for example `["concise"]`. Skills live at `skills/<name>/SKILL.md` and are prepended to the prompt. `attachments` takes absolute local file paths and uploads them to DeepSeek Web before the prompt is sent. `includeThinking: true` returns the thinking text visibly rendered by DeepSeek Web separately from the final answer. The bridge also maps the current Web UI controls for Instant, Expert, Image Recognition, DeepThink, and Smart Search.

Tool calls use an MCP-friendly host round trip. Pass the host's available tool schemas in `tools`. If DeepSeek requests one, `toolCalls` is returned. Execute it in the host, then call `ask_web_deepseek` again with the returned `conversationUrl` and the matching `toolResults`. The browser bridge does not pretend DeepSeek Web has native MCP access; the host remains responsible for executing tools.

The current signed-in Web UI advertises uploads for common images (`png`, `jpg`, `webp`, `gif`, `svg`), PDFs, Office documents, spreadsheets, text/Markdown/CSV/JSON, source-code files, and several additional document/image formats. Use `deepseek_web_capabilities` to read the live `accept` list instead of hard-coding it in clients.

Headless mode is supported after the one-time manual login. Set `DEEPSEEK_WEB_HEADLESS=1` and the bridge reuses the same signed-in browser profile without showing a window.

CLI examples:

```powershell
npm run chat -- "Explain this carefully" --mode expert --deep-think --show-thinking --new-chat
npm run chat -- "What is in this file?" --mode imageRecognition --attach C:\path\image.png --new-chat
npm run chat -- "Find the latest information about this topic" --search --new-chat
$env:DEEPSEEK_WEB_HEADLESS="1"; npm run chat -- "Headless test" --new-chat
```

```sh
DEEPSEEK_WEB_HEADLESS=1 npm run chat -- "Headless test" --new-chat
```

## Credits

Inspired by [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web), especially its local bridge -> owned browser session -> web AI response pattern. This project is a separate DeepSeek-oriented implementation.

## Notes

- Windows, Linux/Ubuntu, and macOS are supported. Common Chrome, Chromium, and Edge locations plus PATH are detected automatically.
- Set `DEEPSEEK_WEB_CHROME` to the browser executable if auto-detection does not find it.
- If the site asks for verification or login again, run `npm run login` and complete it manually.
- Browser/site UI changes can require selector updates.

MIT licensed.
