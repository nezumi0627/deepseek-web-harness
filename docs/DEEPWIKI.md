# DeepWiki entrypoint

When the API is running, the same guide is available at `GET /deepwiki`. DeepWiki can index the GitHub repository directly, or use this endpoint for a local instance.

Use these repository files as the canonical source when indexing this project in DeepWiki:

1. `README.md` — project purpose, setup, MCP usage, disclaimer.
2. `docs/ARCHITECTURE.md` — runtime components and data flow.
3. `docs/API.md` — REST compatibility behavior and client examples.
4. `openapi.json` — machine-readable HTTP contract.
5. `server/browser.js` — signed-in browser transport.
6. `server/api.js` — OpenAI/Anthropic compatibility layer.
7. `server/index.js` — MCP server.

DeepWiki URL for this GitHub repository: `https://deepwiki.com/nezumi0627/deepseek-web-harness`.
