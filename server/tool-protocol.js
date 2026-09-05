function parseJsonEnvelope(text) {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value?.type === "tool_calls" && Array.isArray(value.calls)) return value;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function buildToolAwarePrompt(prompt, tools = [], toolResults = []) {
  if (!tools.length && !toolResults.length) return prompt.trim();
  const catalog = tools.map(tool => ({
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.inputSchema || {}
  }));
  const protocol = [
    "## External tool protocol",
    "You can request tools from the host harness. When a tool is required, reply ONLY with this JSON shape and no Markdown:",
    '{"type":"tool_calls","calls":[{"id":"call_1","name":"tool_name","arguments":{}}]}',
    "Use only the tools listed below. If no tool is needed, answer normally.",
    `Available tools: ${JSON.stringify(catalog)}`
  ].join("\n");

  if (toolResults.length) {
    return [
      "Continue the existing task using these host tool results.",
      `Tool results: ${JSON.stringify(toolResults)}`,
      protocol
    ].join("\n\n");
  }
  return [prompt.trim(), protocol].join("\n\n");
}

export function parseToolCalls(text, tools = []) {
  const envelope = parseJsonEnvelope(text);
  if (!envelope) return [];
  const allowed = new Set(tools.map(tool => tool.name));
  return envelope.calls.map((call, index) => {
    if (!call || typeof call.name !== "string" || !call.name) throw new Error("DeepSeek returned an invalid tool call name.");
    if (allowed.size && !allowed.has(call.name)) throw new Error(`DeepSeek requested an unavailable tool: ${call.name}`);
    const args = call.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(`DeepSeek returned invalid arguments for tool: ${call.name}`);
    return {
      id: typeof call.id === "string" && call.id ? call.id : `call_${index + 1}`,
      name: call.name,
      arguments: args
    };
  });
}
