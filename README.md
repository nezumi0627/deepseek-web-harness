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

Start the local OpenAI/Anthropic-compatible REST API:

```sh
npm run api
```

`npm start` は API サーバーモードで起動します。対話型の簡易 harness を使う場合だけ `npm start -- --harness`（または `npm run harness`）を指定します。harness では独立 session の切り替え、履歴・conversation URL の同期、fork/rename/compact、DeepThink/Search、画像やファイル添付、skill、自動 skill 選択、ストリーム風表示、推定 token 数と速度表示が使えます。ブラウザ UI は応答完了後にテキストを受け取るため、表示ストリームは遅延再生です。

Default base URL: `http://127.0.0.1:8787`. Swagger UI is available at `http://127.0.0.1:8787/docs`, the OpenAPI 3.1 document is at `/openapi.json`, and the DeepWiki indexing guide is at `/deepwiki`.

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

REST compatibility endpoints:

- `POST /v1/chat/completions` — OpenAI Chat Completions compatible.
- `POST /v1/responses` — OpenAI Responses compatible.
- `POST /v1/messages` — Anthropic Messages compatible.
- `POST /v1/auto` — automatically detects Anthropic via `anthropic-version`, OpenAI Responses via `input`, and OpenAI Chat via `messages`.
- `GET /v1/models` — model aliases that automatically map to DeepThink, Expert, Vision, or Search.

See [docs/API.md](docs/API.md) for OpenAI/Anthropic SDK examples and sharing/authentication setup. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the data flow. The repository also has a [DeepWiki entrypoint](docs/DEEPWIKI.md) and [DeepWiki page](https://deepwiki.com/nezumi0627/deepseek-web-harness).

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

## Disclaimer

This is an unofficial third-party project and is not affiliated with, endorsed by, or sponsored by DeepSeek. It automates a browser session that you sign in to and control. You are responsible for using it in accordance with DeepSeek's terms, policies, rate limits, and applicable laws. DeepSeek may change its website, authentication, verification, models, limits, or available features at any time, which can partially or completely break this project. Do not use this project to bypass authentication, verification, access controls, or service restrictions. This software is provided "as is" without warranty; use it at your own risk.

## Notes

- Windows, Linux/Ubuntu, and macOS are supported. Common Chrome, Chromium, and Edge locations plus PATH are detected automatically.
- Set `DEEPSEEK_WEB_CHROME` to the browser executable if auto-detection does not find it.
- If the site asks for verification or login again, run `npm run login` and complete it manually.
- Browser/site UI changes can require selector updates.

MIT licensed.
