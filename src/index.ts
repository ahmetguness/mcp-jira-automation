/**
 * Entry point — loads config and starts the app.
 */

import "dotenv/config";
import { loadConfig } from "./config.js";
import { App } from "./app.js";
import { createLogger } from "./logger.js";

const log = createLogger("main");

async function main(): Promise<void> {
    try {
        const config = loadConfig();
        const app = new App(config);
        await app.start();
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`Fatal error: ${msg}`);
        if (e instanceof Error && e.stack) {
            log.error(e.stack);
        }
        process.exit(1);
    }
}

main();