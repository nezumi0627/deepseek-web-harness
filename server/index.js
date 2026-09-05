import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askWebDeepSeekDetailed, getDeepSeekCapabilities } from "./browser.js";
import { buildPrompt, listSkills } from "./skills.js";
import { buildToolAwarePrompt, parseToolCalls } from "./tool-protocol.js";

const server = new McpServer({ name: "deepseek-web-harness", version: "0.2.0" });

server.registerTool(
  "ask_web_deepseek",
  {
    title: "Ask DeepSeek Web",
    description: "Use the signed-in DeepSeek Web session. Supports local skills, DeepThink, visible thinking text, web search, attachments, and host-executed tool-call round trips.",
    inputSchema: {
      prompt: z.string().min(1),
      skills: z.array(z.string()).default([]),
      mode: z.enum(["instant", "expert", "imageRecognition"]).optional(),
      deepThink: z.boolean().optional(),
      search: z.boolean().optional(),
      newChat: z.boolean().default(false),
      attachments: z.array(z.string()).default([]).describe("Absolute local file paths to upload before sending"),
      includeThinking: z.boolean().default(false),
      conversationUrl: z.string().url().optional().describe("DeepSeek conversation URL returned by a previous call, used for tool-result continuation"),
      tools: z.array(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        inputSchema: z.record(z.string(), z.unknown()).default({})
      })).default([]).describe("Host tools DeepSeek may request. The host executes returned toolCalls."),
      toolResults: z.array(z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        result: z.unknown().optional(),
        error: z.string().optional()
      })).default([]).describe("Results from toolCalls returned by a previous call")
    },
    outputSchema: {
      text: z.string(),
      thinking: z.string().nullable(),
      toolCalls: z.array(z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.record(z.string(), z.unknown())
      })),
      conversationUrl: z.string()
    }
  },
  async ({ prompt, skills, mode, deepThink, search, newChat, attachments, includeThinking, conversationUrl, tools, toolResults }) => {
    try {
      const toolPrompt = buildToolAwarePrompt(prompt, tools, toolResults);
      const result = await askWebDeepSeekDetailed(buildPrompt(toolPrompt, skills), {
        mode,
        deepThink,
        search,
        newChat,
        attachments,
        conversationUrl
      });
      const structuredContent = {
        text: result.text,
        thinking: includeThinking ? result.thinking : null,
        toolCalls: parseToolCalls(result.text, tools),
        conversationUrl: result.conversationUrl
      };
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent
      };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
    }
  }
);

server.registerTool(
  "deepseek_web_capabilities",
  {
    title: "DeepSeek Web Capabilities",
    description: "Inspect the signed-in DeepSeek Web UI and report available controls and upload support.",
    inputSchema: {}
  },
  async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await getDeepSeekCapabilities(), null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
    }
  }
);

server.registerTool(
  "list_deepseek_skills",
  {
    title: "List DeepSeek Skills",
    description: "List local SKILL.md names that can be injected into ask_web_deepseek.",
    inputSchema: {}
  },
  async () => ({ content: [{ type: "text", text: JSON.stringify(listSkills()) }] })
);

await server.connect(new StdioServerTransport());
