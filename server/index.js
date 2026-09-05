import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askWebDeepSeek, getDeepSeekCapabilities } from "./browser.js";
import { buildPrompt, listSkills } from "./skills.js";

const server = new McpServer({ name: "deepseek-web-harness", version: "0.2.0" });

server.registerTool(
  "ask_web_deepseek",
  {
    title: "Ask DeepSeek Web",
    description: "Use the signed-in DeepSeek Web session. Supports local skills, DeepThink, web search, attachments, and fresh chats.",
    inputSchema: {
      prompt: z.string().min(1),
      skills: z.array(z.string()).default([]),
      mode: z.enum(["instant", "expert", "imageRecognition"]).optional(),
      deepThink: z.boolean().optional(),
      search: z.boolean().optional(),
      newChat: z.boolean().default(false),
      attachments: z.array(z.string()).default([]).describe("Absolute local file paths to upload before sending")
    }
  },
  async ({ prompt, skills, mode, deepThink, search, newChat, attachments }) => {
    try {
      const text = await askWebDeepSeek(buildPrompt(prompt, skills), { mode, deepThink, search, newChat, attachments });
      return { content: [{ type: "text", text }] };
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
