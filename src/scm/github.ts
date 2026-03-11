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
        
        try {
            // Try common branch names to detect default branch
            // Try master first (more common for older repos), then main
            const commonBranches = ["master", "main", "develop"];
            for (const branch of commonBranches) {
                try {
                    const rawResult = await this.mcp.callScmTool("get_file_contents", {
                        owner,
                        repo: name,
                        path: "",
                        branch,
                    });
                    
                    // Validate that the result is an array of files instead of an error object
                    parseGitHubFileList(rawResult);
                    
                    log.info(`Detected default branch: ${branch}`);
                    return {
                        name: repo,
                        defaultBranch: branch,
                    };
                } catch {
                    // Try next branch
                }
            }
        } catch (e) {
            log.warn(`Failed to detect default branch for ${repo}: ${String(e)}`);
        }
        
        // Fallback to master (more common default)
        return {
            name: repo,
            defaultBranch: "master",
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
        return this.listFilesRecursive(repo, path ?? "", 0);
    }

    /**
     * Recursively list files in a GitHub repository.
     * GitHub's get_file_contents only returns immediate children of a directory.
     * For monorepos, we need to recurse into subdirectories to find source files.
     */
    private async listFilesRecursive(repo: string, path: string, depth: number): Promise<string[]> {
        const MAX_DEPTH = 4;
        if (depth > MAX_DEPTH) return [];

        const [owner, name] = this.parseRepo(repo);
        const args: Record<string, unknown> = { owner, repo: name, path };

        try {
            const rawResult = await this.mcp.callScmTool("get_file_contents", args);
            const result = parseGitHubFileList(rawResult);

            const files: string[] = [];
            const subdirs: string[] = [];

            for (const entry of result) {
                const entryPath = entry.path ?? entry.name ?? "";
                if (!entryPath) continue;

                if (entry.type === "dir") {
                    subdirs.push(entryPath);
                } else {
                    files.push(entryPath);
                }
            }

            // Recurse into subdirectories (skip common non-source dirs)
            const skipDirs = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", "__pycache__", "vendor", ".venv", "venv"]);
            for (const dir of subdirs) {
                const dirName = dir.split("/").pop() ?? "";
                if (skipDirs.has(dirName)) continue;

                const subFiles = await this.listFilesRecursive(repo, dir, depth + 1);
                files.push(...subFiles);
            }

            return files;
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
        const base = baseBranch ?? "master";

        // (Optional warm-up) some servers require a read to ensure repo/branch exists
        const rawResult = await this.mcp.callScmTool("get_file_contents", {
            owner,
            repo: name,
            path: "",
            branch: base,
        });
        parseGitHubFileList(rawResult);

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
            base: targetBranch ?? "master",
        });

        /**
         * IMPORTANT:
         * github-mcp-server may return:
         * - a PR object (ideal)
         * - OR just a string (often the PR URL)
         *
         * Our pipeline expects a PR URL string.
         */
        if (typeof rawResult === "string") {
            const url = rawResult.trim();

            // if it's already a URL, we're done
            if (url.startsWith("http://") || url.startsWith("https://")) {
                log.info(`Created PR: ${url}`);
                return url;
            }

            // sometimes it's a JSON stringified object
            try {
                const parsed = JSON.parse(url);
                const prObj = parseGitHubPullRequest(parsed);
                const prUrl = prObj?.html_url ?? prObj?.url ?? "";
                if (!prUrl) throw new Error("Parsed PR object did not include a URL.");
                log.info(`Created PR: ${prUrl}`);
                return prUrl;
            } catch {
                throw new Error(`Invalid GitHub PR: create_pull_request returned string but not a URL/object: ${url}`);
            }
        }

        // Otherwise we expect an object
        const result = parseGitHubPullRequest(rawResult);
        const prUrl = result?.html_url ?? result?.url ?? "";

        if (!prUrl) {
            throw new Error(`Invalid GitHub PR: create_pull_request returned an object without html_url/url.`);
        }

        log.info(`Created PR: ${prUrl}`);
        return prUrl;
    }

    private parseRepo(repo: string): [string, string] {
        const parts = repo.split("/");
        if (parts.length < 2) throw new Error(`Invalid GitHub repo format: ${repo}. Expected: owner/repo`);
        return [parts[0]!, parts[1]!];
    }
}
