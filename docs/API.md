# REST API

`npm run api` starts the local compatibility server at `http://127.0.0.1:8787` by default.

## Endpoints

| Endpoint | Compatibility | Notes |
| --- | --- | --- |
| `POST /v1/chat/completions` | OpenAI Chat Completions | Text, tools, delayed SSE streaming |
| `POST /v1/responses` | OpenAI Responses | Text and function calls; non-streaming |
| `POST /v1/messages` | Anthropic Messages | Text, tools, delayed SSE streaming |
| `POST /v1/auto` | Auto detect | Anthropic by `anthropic-version`, Responses by `input`, otherwise Chat |
| `GET /v1/models` | OpenAI / Anthropic | Shape follows `anthropic-version` header |
| `GET /health` | Native | No auth |
| `GET /openapi.json` | OpenAPI 3.1 | No auth |
| `GET /docs` | Swagger UI | No auth |
| `GET /v1/queue` | Queue status | Shows active and waiting requests |
| `GET/POST /v1/sessions` | Session management | Each created session is independent |
| `GET/PATCH/DELETE /v1/sessions/:id` | Session lifecycle | Read, rename, or delete |
| `POST /v1/sessions/:id/fork` | Fork | Creates a new independent session |
| `GET /v1/sessions/:id/trajectory` | Execution history | JSONL events as JSON |
| `POST /v1/sessions/:id/compact` | Context compression | Keeps a bounded summary and recent turns |

Each request creates a fresh session automatically unless `deepseek_web.session_id` is supplied. A session stores its DeepSeek `conversationUrl`, recent messages, estimated token usage, and a JSONL trajectory. The browser profile is still shared internally, so requests wait in a FIFO queue; `GET /v1/queue` exposes the current depth. This keeps separate chats independent while avoiding concurrent use of one Chrome profile.

Context is compacted automatically when the stored session context exceeds its limit, or explicitly with `POST /v1/sessions/:id/compact`. Token counts are estimates based on text length because DeepSeek Web does not expose authoritative API token counts.

## Authentication and sharing

Localhost does not require an API key unless `DEEPSEEK_WEB_API_KEY` is set. Binding to another interface requires a key.

```powershell
$env:DEEPSEEK_WEB_API_HOST="0.0.0.0"
$env:DEEPSEEK_WEB_API_KEY="replace-with-a-long-random-key"
npm run api
```

OpenAI-style clients send `Authorization: Bearer <key>`. Anthropic-style clients may send `x-api-key: <key>`. Both map to the same configured key.

## OpenAI SDK

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://127.0.0.1:8787/v1",
  apiKey: process.env.DEEPSEEK_WEB_API_KEY || "local"
});

const result = await client.chat.completions.create({
  model: "deepseek-reasoner",
  messages: [{ role: "user", content: "Explain 2 + 2." }]
});
console.log(result.choices[0].message.content);
```

## Anthropic SDK

```js
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "http://127.0.0.1:8787",
  apiKey: process.env.DEEPSEEK_WEB_API_KEY || "local"
});

const result = await client.messages.create({
  model: "deepseek-reasoner",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Explain 2 + 2." }]
});
console.log(result.content[0].text);
```

## DeepSeek Web extensions

Both compatibility formats accept the optional `deepseek_web` object:

```json
{
  "deepseek_web": {
    "mode": "expert",
    "deep_think": true,
    "search": false,
    "skills": ["concise"],
    "attachments": ["C:/absolute/path/file.pdf"],
    "include_thinking": false,
    "session_id": "sess_..."
  }
}
```

Model aliases also switch Web features automatically: `deepseek-reasoner`, `deepseek-expert`, `deepseek-vision`, and `deepseek-search`.

Chat/Anthropic streaming is protocol-compatible delayed SSE: the browser response is completed first, then emitted as stream events. The response error shape includes a stable `error.code`, a `deepseek_web.retryable` hint, and `x-deepseek-error-code` so browser failures can be handled by clients without parsing prose.

Tool schemas and tool results are translated between the OpenAI and Anthropic shapes. The web bridge returns requested tool calls for the caller to execute and resubmit; it does not execute arbitrary caller supplied code inside the API process. This keeps file, shell, commit, and other host actions under the caller's own tool policy.
