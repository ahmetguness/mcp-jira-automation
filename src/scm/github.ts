/**
 * GitHub SCM provider — uses the official github-mcp-server tools.
 */

import type { ScmProvider } from "./provider.js";
import type { ScmFile, RepoInfo } from "../types.js";
import { parseGitHubFile, parseGitHubFileList, parseGitHubPullRequest } from "../validation/scm.js";
import type { McpManager } from "../mcp/manager.js";
import { createLogger } from "../logger.js";

const log = createLogger("scm:github");

export class GitHubProvider implements ScmProvider {
    constructor(private mcp: McpManager) { }

    async getRepoInfo(repo: string): Promise<RepoInfo> {
        const [owner, name] = this.parseRepo(repo);

        // Repo doğrulamasını MCP ile yapmıyoruz.
        // Çünkü bazı GitHub MCP server’larda "get_repository" tool’u yok.
        // Repo yoksa zaten clone/fetch aşaması patlayacak.
        return {
            name: repo,
            defaultBranch: "main",
        };
    }

    async readFile(repo: string, path: string, branch?: string): Promise<string> {
        const [owner, name] = this.parseRepo(repo);
        const args: Record<string, unknown> = { owner, repo: name, path };
        if (branch) args.branch = branch;

        const rawResult = await this.mcp.callScmTool("get_file_contents", args);
        const result = parseGitHubFile(rawResult);
        // github-mcp-server may return content directly or base64
        if (typeof result === "string") return result;
        if (result?.content) {
            if (result.encoding === "base64") {
                return Buffer.from(result.content, "base64").toString("utf-8");
            }
            return result.content;
        }
        return JSON.stringify(result);
    }

    async listFiles(repo: string, path?: string, _branch?: string): Promise<string[]> {
        const [owner, name] = this.parseRepo(repo);
        const args: Record<string, unknown> = { owner, repo: name, path: path ?? "" };

        const rawResult = await this.mcp.callScmTool("get_file_contents", args);
        try {
            const result = parseGitHubFileList(rawResult);
            return result.map((f) => f.path ?? f.name ?? (typeof f === "string" ? f : ""));
        } catch {
            return [];
        }
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
        const [owner, name] = this.parseRepo(repo);
        const base = baseBranch ?? "main";

        // Get the SHA of the base branch
        await this.mcp.callScmTool("get_file_contents", {
            owner,
            repo: name,
            path: "",
            branch: base,
        });

        await this.mcp.callScmTool("create_branch", {
            owner,
            repo: name,
            branch: branchName,
            from_branch: base,
        });

        log.info(`Created branch ${branchName} from ${base}`);
    }

    async writeFile(repo: string, path: string, content: string, message: string, branch: string): Promise<void> {
        const [owner, name] = this.parseRepo(repo);
        await this.mcp.callScmTool("create_or_update_file", {
            owner,
            repo: name,
            path,
            content,
            message,
            branch,
        });
    }

    async createPullRequest(
        repo: string,
        title: string,
        body: string,
        sourceBranch: string,
        targetBranch?: string,
    ): Promise<string> {
        const [owner, name] = this.parseRepo(repo);
        const rawResult = await this.mcp.callScmTool("create_pull_request", {
            owner,
            repo: name,
            title,
            body,
            head: sourceBranch,
            base: targetBranch ?? "main",
        });
        const result = parseGitHubPullRequest(rawResult);

        const prUrl = result?.html_url ?? result?.url ?? "";
        log.info(`Created PR: ${prUrl}`);
        return prUrl;
    }

    private parseRepo(repo: string): [string, string] {
        const parts = repo.split("/");
        if (parts.length < 2) throw new Error(`Invalid GitHub repo format: ${repo}. Expected: owner/repo`);
        return [parts[0]!, parts[1]!];
    }
}
