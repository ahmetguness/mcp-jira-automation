/**
 * Bootstrap: ensure the terminal uses UTF-8 so emojis and
 * non-ASCII characters (Turkish ü, ş, etc.) render correctly.
 *
 * Import this module FIRST in index.ts — before any logging.
 */

import { execSync } from "node:child_process";

if (process.platform === "win32") {
    try {
        execSync("chcp 65001", { stdio: "ignore" });
    } catch {
        // non-fatal — terminal may already be UTF-8 or chcp unavailable
    }
}

// Ensure Node streams themselves emit UTF-8
process.stdout.setDefaultEncoding("utf8");
process.stderr.setDefaultEncoding("utf8");
