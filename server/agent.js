import { askWebDeepSeek } from "./browser.js";
import { callMcpTool, formatMcpToolResult, listMcpTools } from "./mcp-tools.js";

function toolInstructions(tools) {
  if (!tools.length) return "";
  const rows = tools.map(tool => [
    `- ${tool.name}`,
    `  description: ${tool.description || "No description"}`,
    `  inputSchema: ${JSON.stringify(tool.inputSchema || {})}`
  ].join("\n"));
  return [
    "## Host tools",
    "You may call the MCP tools listed below.",
    "When you need a tool, output ONLY one tool call in exactly this form and nothing else:",
    '<tool_call>{"name":"server/tool","arguments":{}}</tool_call>',
    "Do not use a Markdown code fence around the tool call.",
    "After a tool result is supplied, continue the original task. Call another tool if needed, otherwise answer normally.",
    ...rows
  ].join("\n");
}

function parseToolCall(text) {
  const match = String(text || "").match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed.name !== "string") return null;
    return {
      name: parsed.name,
      arguments: parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {}
    };
  } catch {
    return null;
  }
}

function renderTranscript(entries) {
  return entries.map(entry => `${entry.role.toUpperCase()}:\n${entry.content}`).join("\n\n");
}

export async function runDeepSeekAgent(prompt, options = {}) {
  const toolState = options.useTools === false
    ? { configPath: null, tools: [], errors: [] }
    : await listMcpTools();
  const tools = toolState.tools || [];
  const maxToolCalls = Math.max(0, Number(options.maxToolCalls ?? 8));
  const transcript = [{ role: "user", content: prompt.trim() }];
  const thinking = [];
  const toolCalls = [];

  for (let step = 0; ; step += 1) {
    const context = [
      toolInstructions(tools),
      "## Conversation",
      renderTranscript(transcript)
    ].filter(Boolean).join("\n\n");

    const response = await askWebDeepSeek(context, {
      mode: options.mode,
      deepThink: options.deepThink,
      search: options.search,
      newChat: true,
      attachments: step === 0 ? options.attachments || [] : [],
      includeThink: true,
      timeoutMs: options.timeoutMs,
      loginTimeoutMs: options.loginTimeoutMs
    });

    const detailed = typeof response === "string" ? { text: response, thinking: "" } : response;
    if (detailed.thinking) thinking.push(detailed.thinking);
    const call = tools.length ? parseToolCall(detailed.text) : null;
    if (!call) {
      return {
        text: detailed.text,
        thinking: thinking.join("\n\n"),
        toolCalls,
        availableTools: tools.map(tool => tool.name),
        toolErrors: toolState.errors || []
      };
    }

    if (step >= maxToolCalls) throw new Error(`DeepSeek exceeded maxToolCalls (${maxToolCalls}).`);

    let rawResult;
    let renderedResult;
    try {
      rawResult = await callMcpTool(call.name, call.arguments);
      renderedResult = formatMcpToolResult(rawResult);
    } catch (error) {
      renderedResult = `Tool error: ${error instanceof Error ? error.message : String(error)}`;
    }

    const clipped = String(renderedResult).slice(0, 50_000);
    toolCalls.push({ name: call.name, arguments: call.arguments, result: clipped });
    transcript.push({ role: "assistant", content: detailed.text });
    transcript.push({ role: "tool", content: `<tool_result name=${JSON.stringify(call.name)}>\n${clipped}\n</tool_result>` });
  }
}
