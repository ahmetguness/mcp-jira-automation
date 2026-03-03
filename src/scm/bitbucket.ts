/**
 * Bitbucket SCM provider — uses Kallows/mcp-bitbucket tools.
 */

import type { ScmProvider } from "./provider.js";
import type { ScmFile, RepoInfo } from "../types.js";
import { parseBitbucketSearchResponse, parseBitbucketFile, parseBitbucketPullRequest } from "../validation/scm.js";
import type { McpManager } from "../mcp/manager.js";
import type { Config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("scm:bitbucket");

export class BitbucketProvider implements ScmProvider {
    private workspace: string;

    constructor(
        private mcp: McpManager,
        config: Config,
    ) {
        this.workspace = config.bitbucketWorkspace ?? "";
    }

    async getRepoInfo(repo: string): Promise<RepoInfo> {
        const { workspace, slug } = this.parseRepo(repo);
        // mcp-bitbucket doesn't have a direct "get repo" tool, use search
        const rawResult = await this.mcp.callScmTool("bb_search_repositories", {
            query: `name = "${slug}"`,
            workspace,
            pagelen: 1,
        });
        const result = parseBitbucketSearchResponse(rawResult);

        const first = result?.values?.[0];
        return {
            name: `${workspace}/${slug}`,
            defaultBranch: first?.mainbranch?.name ?? "main",
            description: first?.description ?? "",
        };
    }

    async readFile(repo: string, path: string, branch?: string): Promise<string> {
        const { workspace, slug } = this.parseRepo(repo);
        const args: Record<string, unknown> = {
            repo_slug: slug,
            path,
            workspace,
        };
        if (branch) args.branch = branch;

        const rawResult = await this.mcp.callScmTool("bb_read_file", args);
        const result = parseBitbucketFile(rawResult);
        if (typeof result === "string") return result;
        if (result?.content) return result.content;
        return JSON.stringify(result);
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async listFiles(_repo: string, _path?: string, _branch?: string): Promise<string[]> {
        // mcp-bitbucket doesn't have a tree listing tool, return empty
        log.warn("Bitbucket MCP does not support listing files. Use readFile with known paths.");
        return [];
    }

    async readFiles(repo: string, paths: string[], branch?: string): Promise<ScmFile[]> {
        const files: ScmFile[] = [];
        for (const p of paths) {
            try {
                const content = await this.readFile(repo, p, branch);
                files.push({ path: p, content });
            } catch (e) {
                log.warn(`Failed to read ${repo}/${p}: ${String(e)}`);
            }
        }
        return files;
    }

    async createBranch(repo: string, branchName: string, baseBranch?: string): Promise<void> {
        const { workspace, slug } = this.parseRepo(repo);
        await this.mcp.callScmTool("bb_create_branch", {
            repo_slug: slug,
            branch: branchName,
            workspace,
            start_point: baseBranch ?? "main",
        });
        log.info(`Created branch ${branchName}`);
    }

    async writeFile(repo: string, path: string, content: string, message: string, branch: string): Promise<void> {
        const { workspace, slug } = this.parseRepo(repo);
        await this.mcp.callScmTool("bb_write_file", {
            repo_slug: slug,
            path,
            content,
            branch,
            message,
            workspace,
        });
    }

    async createPullRequest(
        repo: string,
        title: string,
        body: string,
        sourceBranch: string,
        targetBranch?: string,
    ): Promise<string> {
        const { workspace, slug } = this.parseRepo(repo);
        const rawResult = await this.mcp.callScmTool("bb_create_pull_request", {
            repo_slug: slug,
            title,
            description: body,
            source_branch: sourceBranch,
            destination_branch: targetBranch ?? "main",
            workspace,
        });
        const result = parseBitbucketPullRequest(rawResult);

        const prUrl = result?.links?.html?.href ?? result?.url ?? "";
        log.info(`Created PR: ${prUrl}`);
        return prUrl;
    }

    private parseRepo(repo: string): { workspace: string; slug: string } {
        const parts = repo.split("/");
        if (parts.length >= 2) {
            return { workspace: parts[0]!, slug: parts[1]! };
        }
        if (this.workspace) {
            return { workspace: this.workspace, slug: repo };
        }
        throw new Error(`Invalid Bitbucket repo format: ${repo}. Expected: workspace/repo`);
    }
}
