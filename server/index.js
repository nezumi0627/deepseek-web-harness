import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askWebDeepSeek } from "./browser.js";
import { buildPrompt, listSkills } from "./skills.js";

const server = new McpServer({ name: "deepseek-web-harness", version: "0.1.0" });

server.registerTool(
  "ask_web_deepseek",
  {
    title: "Ask DeepSeek Web",
    description: "Send a prompt to the signed-in DeepSeek Web browser session and return the final text response. Optional local skills are injected before the prompt.",
    inputSchema: {
      prompt: z.string().min(1),
      skills: z.array(z.string()).default([])
    }
  },
  async ({ prompt, skills }) => {
    try {
      const text = await askWebDeepSeek(buildPrompt(prompt, skills));
      return { content: [{ type: "text", text }] };
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
