import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askWebDeepSeek, getDeepSeekCapabilities } from "./browser.js";
import { buildPrompt, listSkills } from "./skills.js";
import { buildToolPrompt, parseToolCalls } from "./tools.js";

const server = new McpServer({ name: "deepseek-web-harness", version: "0.3.0" });

const toolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  inputSchema: z.record(z.string(), z.any()).default({ type: "object" })
});

const toolResultSchema = z.object({
  name: z.string().min(1),
  result: z.any()
});

server.registerTool(
  "ask_web_deepseek",
  {
    title: "Ask DeepSeek Web",
    description: "Use the signed-in DeepSeek Web session. Supports skills, DeepThink reasoning capture, web search, attachments, fresh chats, and structured tool calls.",
    inputSchema: {
      prompt: z.string().min(1),
      skills: z.array(z.string()).default([]),
      mode: z.enum(["instant", "expert", "imageRecognition"]).optional(),
      deepThink: z.boolean().optional(),
      includeThink: z.boolean().default(false),
      search: z.boolean().optional(),
      newChat: z.boolean().default(false),
      attachments: z.array(z.string()).default([]).describe("Absolute local file paths to upload before sending"),
      tools: z.array(toolDefinitionSchema).default([]).describe("Tools the caller can execute after DeepSeek requests them"),
      toolResults: z.array(toolResultSchema).default([]).describe("Results from previously requested tool calls")
    }
  },
  async ({ prompt, skills, mode, deepThink, includeThink, search, newChat, attachments, tools, toolResults }) => {
    try {
      const skilledPrompt = buildPrompt(prompt, skills);
      const finalPrompt = buildToolPrompt(skilledPrompt, tools, toolResults);
      const raw = await askWebDeepSeek(finalPrompt, {
        mode,
        deepThink,
        includeThink: true,
        search,
        newChat,
        attachments
      });
      const parsed = parseToolCalls(raw.text);
      const payload = {
        answer: parsed.answer,
        thinking: includeThink ? raw.thinking : "",
        toolCalls: parsed.toolCalls
      };
      const display = [
        payload.answer,
        includeThink && payload.thinking ? `\n\n[DeepSeek thinking]\n${payload.thinking}` : "",
        payload.toolCalls.length ? `\n\n[Tool calls]\n${JSON.stringify(payload.toolCalls, null, 2)}` : ""
      ].join("").trim();
      return {
        content: [{ type: "text", text: display || JSON.stringify(payload) }],
        structuredContent: payload
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
    description: "Inspect the signed-in DeepSeek Web UI and report modes, reasoning capture, headless state, browser, search, and upload support.",
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
