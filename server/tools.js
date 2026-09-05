function normalizeTool(tool) {
  if (!tool || typeof tool !== "object") throw new Error("Tool definitions must be objects");
  const name = String(tool.name || "").trim();
  if (!name) throw new Error("Tool definition is missing name");
  return {
    name,
    description: String(tool.description || "").trim(),
    inputSchema: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object" }
  };
}

export function buildToolPrompt(prompt, tools = [], toolResults = []) {
  const normalized = tools.map(normalizeTool);
  if (!normalized.length && !toolResults.length) return prompt.trim();

  const sections = [prompt.trim()];
  if (normalized.length) {
    sections.push(`## Available tools\n${JSON.stringify(normalized, null, 2)}`);
    sections.push(`## Tool-call protocol\nWhen a tool is required, emit one or more tool calls using exactly this XML wrapper and valid JSON:\n<tool_call>{"name":"tool_name","arguments":{}}</tool_call>\nUse only names from Available tools. Do not invent tools. After emitting tool calls, stop and wait for tool results. If no tool is needed, answer normally.`);
  }
  if (toolResults.length) {
    sections.push(`## Tool results\n${JSON.stringify(toolResults, null, 2)}\nContinue the task using these results. You may request another tool call if needed.`);
  }
  return sections.join("\n\n");
}

export function parseToolCalls(text) {
  const toolCalls = [];
  const pattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let match;
  while ((match = pattern.exec(text))) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed.name === "string" && parsed.name.trim()) {
        toolCalls.push({
          name: parsed.name.trim(),
          arguments: parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {}
        });
      }
    } catch {
      // Ignore malformed tool-call blocks and leave them in the visible answer.
    }
  }
  const answer = text.replace(pattern, "").trim();
  return { answer, toolCalls };
}
