# Architecture

```text
OpenAI SDK / Anthropic SDK / generic HTTP client
                     |
                     v
               server/api.js
        format detection + validation
        queue + session lifecycle
          OpenAI <-> common prompt
        Anthropic <-> common prompt
                     |
              server/state.js
      sessions / token estimates / JSONL
                     |
           skills + tool protocol
                     |
                     v
              server/browser.js
                     |
        signed-in Chrome/Edge profile
                     |
                     v
               DeepSeek Web
```

The REST compatibility layer and the MCP server share the same browser bridge. REST requests are serialized because Chromium cannot safely open the same persistent profile in multiple concurrent processes. Each REST request receives a new logical session unless a caller supplies `deepseek_web.session_id`; session state is persisted under `DEEPSEEK_WEB_STATE_DIR` (default `~/.deepseek-web-bridge/state`).

The API surface is contract-first: `openapi.json` is the public REST contract, `/docs` renders it with Swagger UI, and `docs/API.md` contains client examples and behavior that does not fit naturally in OpenAPI fields.
