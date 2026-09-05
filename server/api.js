import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { askWebDeepSeekDetailed } from "./browser.js";
import { autoSelectSkills, buildPrompt, forceLanguage } from "./skills.js";
import { buildToolAwarePrompt, parseToolCalls } from "./tool-protocol.js";
import { appendTrajectory, compactSession, createSession, deleteSession, estimateTokens, getSession, listSessions, readTrajectory, updateSession } from "./state.js";
import { askWithLocalToolLoop } from "./agent.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OPENAPI = JSON.parse(readFileSync(join(ROOT, "openapi.json"), "utf8"));
const DEEPWIKI = readFileSync(join(ROOT, "docs", "DEEPWIKI.md"), "utf8");
const WEBUI = readFileSync(join(ROOT, "webui", "index.html"), "utf8");
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const MODELS = [
  { id: "deepseek-web", description: "Current DeepSeek Web default mode" },
  { id: "deepseek-chat", description: "Alias for DeepSeek Web chat" },
  { id: "deepseek-reasoner", description: "DeepThink enabled" },
  { id: "deepseek-expert", description: "Expert mode" },
  { id: "deepseek-vision", description: "Image Recognition mode; use deepseek_web.attachments for local files" },
  { id: "deepseek-search", description: "Smart Search enabled" }
];

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function sendJson(res, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function sendSse(res, events) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  for (const event of events) res.write(event);
  res.end();
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, "REQUEST_TOO_LARGE", "Request body exceeds 2 MiB.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }
}

function authToken(req) {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer || req.headers["x-api-key"] || null;
}

function assertAuthorized(req, apiKey) {
  if (!apiKey) return;
  if (authToken(req) !== apiKey) throw new ApiError(401, "INVALID_API_KEY", "Invalid or missing API key.");
}

function contentText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);

  return content.map(part => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    if (["text", "input_text", "output_text"].includes(part.type) && typeof part.text === "string") return part.text;
    if (part.type === "tool_result") return `Tool result ${part.tool_use_id || ""}: ${contentText(part.content)}`;
    if (part.type === "tool_use") return `Tool call ${part.id || ""} ${part.name || ""}: ${JSON.stringify(part.input || {})}`;
    if (["image", "image_url", "input_image"].includes(part.type)) {
      throw new ApiError(400, "UNSUPPORTED_IMAGE_INPUT", "Image URLs/data blocks are not fetched by the REST adapter yet. Use deepseek_web.attachments with server-local file paths.");
    }
    return JSON.stringify(part);
  }).filter(Boolean).join("\n");
}

function messagesToPrompt(messages) {
  if (!Array.isArray(messages) || !messages.length) throw new ApiError(400, "MISSING_MESSAGES", "messages must be a non-empty array.");
  return messages.map(message => {
    const role = String(message?.role || "user");
    const text = contentText(message?.content);
    const calls = Array.isArray(message?.tool_calls) && message.tool_calls.length
      ? `\nTool calls: ${JSON.stringify(message.tool_calls)}`
      : "";
    const callId = message?.tool_call_id ? ` (${message.tool_call_id})` : "";
    return `${role}${callId}: ${text}${calls}`.trim();
  }).join("\n\n");
}

function anthropicPrompt(body) {
  const system = body.system ? [{ role: "system", content: body.system }] : [];
  return messagesToPrompt([...system, ...(body.messages || [])]);
}

function responsesInputToPrompt(input) {
  if (typeof input === "string") return `user: ${input}`;
  if (!Array.isArray(input) || !input.length) throw new ApiError(400, "MISSING_INPUT", "input must be a non-empty string or array.");
  return input.map(item => {
    if (typeof item === "string") return `user: ${item}`;
    if (!item || typeof item !== "object") return String(item);
    if (item.type === "function_call_output") return `tool (${item.call_id || ""}): ${contentText(item.output)}`;
    return `${item.role || item.type || "user"}: ${contentText(item.content ?? item.text ?? item.input)}`;
  }).join("\n\n");
}

function openAiTools(tools = []) {
  return tools.filter(tool => tool?.type === "function" && tool.function?.name).map(tool => ({
    name: tool.function.name,
    description: tool.function.description || "",
    inputSchema: tool.function.parameters || {}
  }));
}

function responseApiTools(tools = []) {
  return tools.filter(tool => tool?.type === "function" && tool.name).map(tool => ({
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.parameters || {}
  }));
}

function anthropicTools(tools = []) {
  return tools.filter(tool => tool?.name).map(tool => ({
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.input_schema || {}
  }));
}

function modelOptions(model = "deepseek-web") {
  const value = String(model).toLowerCase();
  if (/reason|think|r1/.test(value)) return { deepThink: true };
  if (/expert/.test(value)) return { mode: "expert" };
  if (/vision|image/.test(value)) return { mode: "imageRecognition" };
  if (/search/.test(value)) return { search: true };
  return {};
}

function deepSeekOptions(body) {
  const ext = body?.deepseek_web || {};
  return {
    ...modelOptions(body?.model),
    ...(ext.mode ? { mode: ext.mode } : {}),
    ...(typeof ext.deep_think === "boolean" ? { deepThink: ext.deep_think } : {}),
    ...(typeof ext.search === "boolean" ? { search: ext.search } : {}),
    attachments: Array.isArray(ext.attachments) ? ext.attachments : [],
    conversationUrl: ext.conversation_url || undefined,
    newChat: !ext.conversation_url
  };
}

function detectFormat(body, headers = {}) {
  if (headers["anthropic-version"]) return "anthropic";
  if (Object.prototype.hasOwnProperty.call(body || {}, "input")) return "openai-responses";
  if (Array.isArray(body?.messages)) {
    const anthropicBlock = body.messages.some(message => Array.isArray(message?.content) && message.content.some(part => ["tool_use", "tool_result"].includes(part?.type)));
    if (anthropicBlock) return "anthropic";
    return "openai-chat";
  }
  throw new ApiError(400, "UNKNOWN_REQUEST_FORMAT", "Could not detect OpenAI or Anthropic request format.");
}

function modelId(body) {
  return typeof body?.model === "string" && body.model ? body.model : "deepseek-web";
}

function deepSeekMeta(result, body) {
  return {
    conversation_url: result.conversationUrl,
    thinking: body?.deepseek_web?.include_thinking ? result.thinking : null
  };
}

function openAiChatResponse(body, result, toolCalls) {
  const id = `chatcmpl_${randomUUID()}`;
  const message = toolCalls.length
    ? {
        role: "assistant",
        content: null,
        tool_calls: toolCalls.map(call => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.arguments) }
        }))
      }
    : { role: "assistant", content: result.text };
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId(body),
    choices: [{ index: 0, message, logprobs: null, finish_reason: toolCalls.length ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    deepseek_web: deepSeekMeta(result, body)
  };
}

function openAiResponsesResponse(body, result, toolCalls) {
  const id = `resp_${randomUUID()}`;
  const output = toolCalls.length
    ? toolCalls.map(call => ({
        type: "function_call",
        id: `fc_${randomUUID()}`,
        call_id: call.id,
        name: call.name,
        arguments: JSON.stringify(call.arguments),
        status: "completed"
      }))
    : [{
        type: "message",
        id: `msg_${randomUUID()}`,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: result.text, annotations: [] }]
      }];
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: modelId(body),
    output,
    output_text: toolCalls.length ? "" : result.text,
    error: null,
    deepseek_web: deepSeekMeta(result, body)
  };
}

function anthropicResponse(body, result, toolCalls) {
  return {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: modelId(body),
    content: toolCalls.length
      ? toolCalls.map(call => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments }))
      : [{ type: "text", text: result.text }],
    stop_reason: toolCalls.length ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    deepseek_web: deepSeekMeta(result, body)
  };
}

function openAiChatSse(response) {
  const choice = response.choices[0];
  const delta = choice.message.tool_calls
    ? { role: "assistant", tool_calls: choice.message.tool_calls.map((call, index) => ({ index, ...call })) }
    : { role: "assistant", content: choice.message.content };
  const base = { id: response.id, object: "chat.completion.chunk", created: response.created, model: response.model };
  return [
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] })}\n\n`,
    "data: [DONE]\n\n"
  ];
}

function anthropicSse(response) {
  const first = response.content[0];
  const start = { ...response, content: [], stop_reason: null, stop_sequence: null };
  const blockStart = first.type === "tool_use"
    ? { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: first.id, name: first.name, input: {} } }
    : { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
  const delta = first.type === "tool_use"
    ? { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(first.input) } }
    : { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: first.text } };
  const event = value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
  return [
    event({ type: "message_start", message: start }),
    event(blockStart),
    event(delta),
    event({ type: "content_block_stop", index: 0 }),
    event({ type: "message_delta", delta: { stop_reason: response.stop_reason, stop_sequence: null }, usage: { output_tokens: 0 } }),
    event({ type: "message_stop" })
  ];
}

function swaggerHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>DeepSeek Web Harness API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',deepLinking:true,persistAuthorization:true});</script></body></html>`;
}

function formatError(format, error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error?.code || "INTERNAL_ERROR";
  const details = { code, retryable: Number(error?.status) >= 500 || code === "TIMEOUT" };
  if (format === "anthropic") return { type: "error", error: { type: code === "INVALID_API_KEY" ? "authentication_error" : "invalid_request_error", message } };
  return { error: { message, type: code === "INVALID_API_KEY" ? "authentication_error" : "invalid_request_error", param: null, code, deepseek_web: details } };
}

export function createApiServer({ ask = askWebDeepSeekDetailed, apiKey = process.env.DEEPSEEK_WEB_API_KEY || "", webUi = false } = {}) {
  let queue = Promise.resolve();
  let queueDepth = 0;
  const queuedAsk = task => {
    queueDepth += 1;
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    next.finally(() => { queueDepth -= 1; }).catch(() => {});
    return next;
  };

  return createHttpServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const corsOrigin = process.env.DEEPSEEK_WEB_CORS_ORIGIN;
    if (corsOrigin) {
      res.setHeader("access-control-allow-origin", corsOrigin);
      res.setHeader("access-control-allow-headers", "authorization,content-type,x-api-key,anthropic-version");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    }
    if (req.method === "OPTIONS") return res.end();

    let format = url.pathname === "/v1/messages" ? "anthropic" : "openai-chat";
    try {
      if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { status: "ok", service: "deepseek-web-harness" });
      if (req.method === "GET" && url.pathname === "/v1/queue") return sendJson(res, 200, { active: queueDepth > 0, queued: Math.max(0, queueDepth - 1), depth: queueDepth });
      if (req.method === "GET" && url.pathname === "/openapi.json") return sendJson(res, 200, OPENAPI);
      if (req.method === "GET" && url.pathname === "/deepwiki") {
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "content-length": Buffer.byteLength(DEEPWIKI) });
        return res.end(DEEPWIKI);
      }
      if (webUi && req.method === "GET" && ["/web", "/web/", "/web/index.html"].includes(url.pathname)) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(WEBUI) });
        return res.end(WEBUI);
      }
      if (req.method === "GET" && ["/docs", "/swagger"].includes(url.pathname)) {
        const html = swaggerHtml();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) });
        return res.end(html);
      }
      if (req.method === "GET" && url.pathname === "/") {
        return sendJson(res, 200, {
          name: "deepseek-web-harness",
          endpoints: ["/v1/chat/completions", "/v1/responses", "/v1/messages", "/v1/auto", "/v1/models"],
          docs: "/docs",
          openapi: "/openapi.json",
          sessions: "/v1/sessions",
          queue: "/v1/queue"
        });
      }

      assertAuthorized(req, apiKey);

      if (url.pathname === "/v1/sessions" && req.method === "GET") return sendJson(res, 200, { data: listSessions() });
      if (url.pathname === "/v1/sessions" && req.method === "POST") {
        const body = await readJson(req);
        if (body.title !== undefined && (typeof body.title !== "string" || body.title.length > 200)) throw new ApiError(422, "INVALID_TITLE", "title must be at most 200 characters.");
        return sendJson(res, 201, createSession({ title: body.title || undefined }));
      }
      const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)(?:\/(trajectory|compact|fork))?$/);
      if (sessionMatch) {
        const [, id, action] = sessionMatch;
        const session = getSession(id);
        if (!session) throw new ApiError(404, "SESSION_NOT_FOUND", "Session not found.");
        if (req.method === "GET" && !action) return sendJson(res, 200, session);
        if (req.method === "GET" && action === "trajectory") return sendJson(res, 200, { data: readTrajectory(id) });
        if (req.method === "POST" && action === "compact") return sendJson(res, 200, compactSession(session).session);
        if (req.method === "POST" && action === "fork") return sendJson(res, 201, createSession({ title: `${session.title} (fork)`, parentId: session.id }));
        if (req.method === "PATCH" && !action) { const body = await readJson(req); if (typeof body.title !== "string" || !body.title.trim()) throw new ApiError(422, "INVALID_TITLE", "title must be a non-empty string."); return sendJson(res, 200, updateSession({ ...session, title: body.title.trim() })); }
        if (req.method === "DELETE" && !action) { deleteSession(id); return res.writeHead(204).end(); }
      }

      if (req.method === "GET" && url.pathname === "/v1/models") {
        if (req.headers["anthropic-version"]) {
          return sendJson(res, 200, {
            data: MODELS.map(model => ({ id: model.id, type: "model", display_name: model.id, created_at: "2026-01-01T00:00:00Z" })),
            has_more: false,
            first_id: MODELS[0].id,
            last_id: MODELS.at(-1).id
          });
        }
        return sendJson(res, 200, { object: "list", data: MODELS.map(model => ({ id: model.id, object: "model", created: 0, owned_by: "deepseek-web-harness" })) });
      }

      if (req.method !== "POST") throw new ApiError(404, "NOT_FOUND", "Endpoint not found.");
      const body = await readJson(req);
      if (["/v1/auto", "/v1"].includes(url.pathname)) format = detectFormat(body, req.headers);
      else if (url.pathname === "/v1/chat/completions") format = "openai-chat";
      else if (url.pathname === "/v1/responses") format = "openai-responses";
      else if (url.pathname === "/v1/messages") format = "anthropic";
      else throw new ApiError(404, "NOT_FOUND", "Endpoint not found.");

      let prompt;
      let tools;
      if (format === "openai-responses") {
        prompt = responsesInputToPrompt(body.input);
        tools = responseApiTools(body.tools);
      } else {
        prompt = format === "anthropic" ? anthropicPrompt(body) : messagesToPrompt(body.messages);
        tools = format === "anthropic" ? anthropicTools(body.tools) : openAiTools(body.tools);
      }

      const ext = body.deepseek_web || {};
      let session = ext.session_id ? getSession(ext.session_id) : createSession({ title: prompt.slice(0, 60) });
      if (!session) throw new ApiError(404, "SESSION_NOT_FOUND", "deepseek_web.session_id was not found.");
      const compacted = compactSession(session);
      session = compacted.session;
      const skills = Array.isArray(ext.skills) && ext.skills.length ? ext.skills : autoSelectSkills(prompt);
      const fullPrompt = forceLanguage(buildPrompt(buildToolAwarePrompt(prompt, tools), skills), ext.language);
      appendTrajectory(session.id, { type: "request", format, prompt, skills, compacted: compacted.compacted });
      const inputTokens = estimateTokens(fullPrompt);
      const callOptions = { ...deepSeekOptions(body), conversationUrl: session.conversationUrl || deepSeekOptions(body).conversationUrl, newChat: !session.conversationUrl };
      const result = await queuedAsk(() => ext.local_tools ? askWithLocalToolLoop(ask, fullPrompt, { ...callOptions, tools, maxToolTurns: ext.max_tool_turns }) : ask(fullPrompt, callOptions));
      const toolCalls = result.toolCalls || parseToolCalls(result.text, tools);
      const outputTokens = estimateTokens(result.text);
      session = updateSession({ ...session, conversationUrl: result.conversationUrl || session.conversationUrl, messages: [...session.messages, { role: "user", content: prompt }, { role: "assistant", content: result.text }], usage: { inputTokens: session.usage.inputTokens + inputTokens, outputTokens: session.usage.outputTokens + outputTokens, totalTokens: session.usage.totalTokens + inputTokens + outputTokens } });
      appendTrajectory(session.id, { type: "response", text: result.text, thinking: result.thinking || null, toolCalls, conversationUrl: result.conversationUrl, usage: { inputTokens, outputTokens } });

      if (format === "anthropic") {
        const response = anthropicResponse(body, result, toolCalls);
        response.usage = { input_tokens: inputTokens, output_tokens: outputTokens };
        response.deepseek_web.session_id = session.id;
        return body.stream ? sendSse(res, anthropicSse(response)) : sendJson(res, 200, response, { "x-deepseek-conversation-url": result.conversationUrl, "x-deepseek-session-id": session.id });
      }
      if (format === "openai-responses") {
        if (body.stream) throw new ApiError(400, "UNSUPPORTED_STREAMING", "Streaming for /v1/responses is not implemented yet. Use stream:false or /v1/chat/completions.");
        const response = openAiResponsesResponse(body, result, toolCalls); response.usage = { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens }; response.deepseek_web.session_id = session.id;
        return sendJson(res, 200, response, { "x-deepseek-conversation-url": result.conversationUrl, "x-deepseek-session-id": session.id });
      }

      const response = openAiChatResponse(body, result, toolCalls);
      response.usage = { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens }; response.deepseek_web.session_id = session.id;
      return body.stream ? sendSse(res, openAiChatSse(response)) : sendJson(res, 200, response, { "x-deepseek-conversation-url": result.conversationUrl, "x-deepseek-session-id": session.id });
    } catch (error) {
      const status = Number(error?.status) || 500;
      if (status >= 500) console.error(error);
      res.setHeader("x-deepseek-error-code", String(error?.code || "INTERNAL_ERROR"));
      sendJson(res, status, formatError(format, error));
    }
  });
}

export function startApiServer({ webUi = process.argv.includes("--webui") } = {}) {
  const host = process.env.DEEPSEEK_WEB_API_HOST || DEFAULT_HOST;
  const port = Number(process.env.DEEPSEEK_WEB_API_PORT || DEFAULT_PORT);
  const apiKey = process.env.DEEPSEEK_WEB_API_KEY || "";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DEEPSEEK_WEB_API_PORT must be a valid TCP port.");
  if (!isLoopback(host) && !apiKey) throw new Error("DEEPSEEK_WEB_API_KEY is required when binding the API server outside localhost.");
  const server = createApiServer({ apiKey, webUi });
  server.listen(port, host, () => {
    console.log(`DeepSeek Web API listening on http://${host}:${port}`);
    console.log(`Swagger: http://${host}:${port}/docs`);
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startApiServer();

export { detectFormat, messagesToPrompt, responsesInputToPrompt };
