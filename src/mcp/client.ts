import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export async function connectMcp() {
    const url = process.env.MCP_SSE_URL || "http://127.0.0.1:7000/sse";

    const transport = new SSEClientTransport(new URL(url));
    const client = new Client({ name: "mcp-jira-automation", version: "0.1.0" });

    await client.connect(transport);
    return client;
}