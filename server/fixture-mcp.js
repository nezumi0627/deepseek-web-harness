import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "deepseek-web-harness-fixture", version: "0.3.0" });

server.registerTool(
  "echo",
  {
    title: "Echo",
    description: "Return the supplied text. Used only by the integration check.",
    inputSchema: {
      text: z.string()
    }
  },
  async ({ text }) => ({ content: [{ type: "text", text: `echo:${text}` }] })
);

await server.connect(new StdioServerTransport());
