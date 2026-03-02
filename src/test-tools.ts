import { connectMcp } from "./mcp/client.js";

async function main() {
    const client = await connectMcp();

    const tools = await client.listTools();
    console.log("TOOLS:");
    console.log(tools);
}

main().catch(console.error);