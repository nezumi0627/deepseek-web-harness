import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askWebDeepSeek, getDeepSeekCapabilities } from "./browser.js";
import { buildPrompt, listSkills } from "./skills.js";
import { buildToolPrompt, parseToolCalls } from "./tools.js";
import { runDeepSeekAgent } from "./agent.js";
import { listMcpTools } from "./mcp-tools.js";

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
    description: "Use the signed-in DeepSeek Web session. Supports skills, DeepThink reasoning capture, web search, attachments, fresh chats, and caller-managed structured tool calls.",
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
      const detailed = typeof raw === "string" ? { text: raw, thinking: "" } : raw;
      const parsed = parseToolCalls(detailed.text);
      const payload = {
        answer: parsed.answer,
        thinking: includeThink ? detailed.thinking : "",
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
  "ask_web_deepseek_agent",
  {
    title: "Ask DeepSeek Web with MCP tools",
    description: "Run DeepSeek Web as an agent. Local SKILL.md files are injected, DeepThink can be captured, and configured MCP tools are executed automatically in a bounded host-side tool loop.",
    inputSchema: {
      prompt: z.string().min(1),
      skills: z.array(z.string()).default([]),
      mode: z.enum(["instant", "expert", "imageRecognition"]).optional(),
      deepThink: z.boolean().optional(),
      includeThink: z.boolean().default(false),
      search: z.boolean().optional(),
      attachments: z.array(z.string()).default([]).describe("Absolute local file paths to upload on the first turn"),
      useTools: z.boolean().default(true),
      maxToolCalls: z.number().int().min(0).max(20).default(8)
    }
  },
  async ({ prompt, skills, mode, deepThink, includeThink, search, attachments, useTools, maxToolCalls }) => {
    try {
      const result = await runDeepSeekAgent(buildPrompt(prompt, skills), {
        mode,
        deepThink,
        search,
        attachments,
        useTools,
        maxToolCalls
      });
      const payload = {
        answer: result.text,
        thinking: includeThink ? result.thinking : "",
        toolCalls: result.toolCalls,
        availableTools: result.availableTools,
        toolErrors: result.toolErrors
      };
      const display = [
        payload.answer,
        includeThink && payload.thinking ? `\n\n[DeepSeek thinking]\n${payload.thinking}` : "",
        payload.toolCalls.length ? `\n\n[Executed MCP tools]\n${JSON.stringify(payload.toolCalls, null, 2)}` : "",
        payload.toolErrors.length ? `\n\n[MCP tool errors]\n${JSON.stringify(payload.toolErrors, null, 2)}` : ""
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
    description: "List local SKILL.md names that can be injected into DeepSeek prompts.",
    inputSchema: {}
  },
  async () => ({ content: [{ type: "text", text: JSON.stringify(listSkills()) }] })
);

server.registerTool(
  "list_deepseek_mcp_tools",
  {
    title: "List DeepSeek MCP Tools",
    description: "List configured host MCP tools that ask_web_deepseek_agent can execute.",
    inputSchema: {}
  },
  async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await listMcpTools(), null, 2) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
    }
  }
);

await server.connect(new StdioServerTransport());
