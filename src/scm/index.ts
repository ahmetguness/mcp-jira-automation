/**
 * SCM factory — creates the correct provider based on config.
 */

import type { Config } from "../config.js";
import type { McpManager } from "../mcp/manager.js";
import type { ScmProvider } from "./provider.js";
import { GitHubProvider } from "./github.js";
import { GitLabProvider } from "./gitlab.js";
import { BitbucketProvider } from "./bitbucket.js";

export function createScmProvider(config: Config, mcp: McpManager): ScmProvider {
    switch (config.scmProvider) {
        case "github":
            return new GitHubProvider(mcp);
        case "gitlab":
            return new GitLabProvider(mcp);
        case "bitbucket":
            return new BitbucketProvider(mcp, config);
        default:
            throw new Error(`Unknown SCM provider: ${config.scmProvider}`);
    }
}

export type { ScmProvider } from "./provider.js";
