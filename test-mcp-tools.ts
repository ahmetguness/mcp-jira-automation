import { McpManager } from "./src/mcp/manager.js";
import { loadConfig } from "./src/config.js";
import * as dotenv from "dotenv";
import * as fs from "fs";

async function main() {
    dotenv.config();

    const config = loadConfig();
    const mcp = new McpManager(config);
    await mcp.connect();

    const scmClient = mcp.getScmClient();
    try {
        const branches = await mcp.callScmTool("list_branches", {
            owner: "ahmetgunesceng1-alt",
            repo: "sloncar-rental-platform"
        });
        fs.writeFileSync("branches.json", JSON.stringify(branches, null, 2));
    } catch(e) {
        fs.writeFileSync("branches.json", JSON.stringify({error: e.message}));
    }
    await mcp.close();
    process.exit(0);
}

main().catch(console.error);
