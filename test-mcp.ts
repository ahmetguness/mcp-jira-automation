import { McpManager } from "./src/mcp/manager.js";
import { loadConfig } from "./src/config.js";

async function main() {
    const config = loadConfig();
    const mcp = new McpManager(config);
    await mcp.connect();

    console.log("Testing master...");
    try {
        const res1 = await mcp.callScmTool("get_file_contents", {
            owner: "ahmetgunesceng1-alt",
            repo: "sloncar-rental-platform",
            path: "",
            branch: "master"
        });
        console.log("Master success:", JSON.stringify(res1).slice(0, 100));
    } catch(e) {
        console.error("Master error:", (e as Error).message);
    }

    console.log("Testing main...");
    try {
        const res2 = await mcp.callScmTool("get_file_contents", {
            owner: "ahmetgunesceng1-alt",
            repo: "sloncar-rental-platform",
            path: "",
            branch: "main"
        });
        console.log("Main success:", JSON.stringify(res2).slice(0, 100));
    } catch(e) {
        console.error("Main error:", (e as Error).message);
    }

    await mcp.close();
}

main().catch(console.error);
