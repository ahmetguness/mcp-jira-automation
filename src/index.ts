import { connectMcp } from "./mcp/client.js";


async function main() {
    console.log("MCP Jira Automation Runner started");
    console.log(`Jira URL: ${process.env.JIRA_BASE_URL || "(not set)"}`);
    console.log("mcp-jira-automation runner is up ✅");

    const client = await connectMcp();
    const { tools } = await client.listTools();

    console.log("MCP tool count:", tools.length);
    console.log("First tools:", tools.slice(0, 15).map((t) => t.name));

    const result = await client.callTool({
        name: "jira_search",
        arguments: {
            jql: "ORDER BY created DESC",
            max_results: 5,
        },
    });

    console.log("Last 5 issues:", JSON.stringify(result, null, 2));

    await client.close();
}

main().catch(console.error);

