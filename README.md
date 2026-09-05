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

The first login is manual in a normal installed Chrome/Edge window. The bridge then reuses that dedicated browser profile. It does not copy cookies or credentials into the repository.

## Setup

```powershell
npm install
npm run login
```

Sign in to DeepSeek in the browser that opens, then close that browser normally.

Verify direct chat:

```powershell
npm run chat -- "Reply with exactly: DEEPSEEK WEB READY"
```

Start the MCP server:

```powershell
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

- `ask_web_deepseek` — prompt DeepSeek Web and return its final text.
- `list_deepseek_skills` — list local skills.

`ask_web_deepseek` accepts `skills`, for example `["concise"]`. Skills live at `skills/<name>/SKILL.md` and are prepended to the prompt.

## Credits

Inspired by [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web), especially its local bridge -> owned browser session -> web AI response pattern. This project is a separate DeepSeek-oriented implementation.

## Notes

- Windows is the Step 1 target.
- Chrome or Edge must be installed.
- If the site asks for verification or login again, run `npm run login` and complete it manually.
- Browser/site UI changes can require selector updates.

MIT licensed.
