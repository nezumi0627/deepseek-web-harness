import { buildToolAwarePrompt, parseToolCalls } from "./tool-protocol.js";
import { executeLocalTool, localToolSchemas } from "./local-tools.js";

export async function askWithLocalToolLoop(ask, prompt, options = {}) {
  const tools = options.tools?.length ? options.tools : localToolSchemas;
  let current = prompt;
  let result;
  const allToolCalls = [];
  for (let turn = 0; turn < (options.maxToolTurns || 8); turn += 1) {
    result = await ask(current, { ...options, newChat: turn === 0 ? options.newChat : false, conversationUrl: turn === 0 ? options.conversationUrl : result.conversationUrl });
    const calls = parseToolCalls(result.text, tools);
    if (!calls.length) return { ...result, toolCalls: allToolCalls };
    allToolCalls.push(...calls);
    const toolResults = [];
    for (const call of calls) {
      try { toolResults.push({ id: call.id, name: call.name, result: await executeLocalTool(call.name, call.arguments) }); }
      catch (error) { toolResults.push({ id: call.id, name: call.name, error: error instanceof Error ? error.message : String(error) }); }
    }
    current = buildToolAwarePrompt("Continue the task using the tool results.", tools, toolResults);
  }
  throw new Error(`Tool loop exceeded ${options.maxToolTurns || 8} turns.`);
}
