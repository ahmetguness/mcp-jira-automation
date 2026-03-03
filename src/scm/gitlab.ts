/**
 * GitLab SCM provider — uses @modelcontextprotocol/server-gitlab tools.
 */

import type { ScmProvider } from "./provider.js";
import type { ScmFile, RepoInfo } from "../types.js";
import { parseGitLabProject, parseGitLabFile, parseGitLabFileList, parseGitLabMergeRequest } from "../validation/scm.js";
import type { McpManager } from "../mcp/manager.js";
import { createLogger } from "../logger.js";

const log = createLogger("scm:gitlab");

export class GitLabProvider implements ScmProvider {
    constructor(private mcp: McpManager) { }

    async getRepoInfo(repo: string): Promise<RepoInfo> {
        const projectPath = encodeURIComponent(repo);
        const rawResult = await this.mcp.callScmTool("get_project", {
            project_id: projectPath,
        });
        const result = parseGitLabProject(rawResult);

        return {
            name: result?.path_with_namespace ?? repo,
            defaultBranch: result?.default_branch ?? "main",
            description: result?.description ?? "",
        };
    }

    async readFile(repo: string, path: string, branch?: string): Promise<string> {
        const projectPath = encodeURIComponent(repo);
        const args: Record<string, unknown> = {
            project_id: projectPath,
            file_path: path,
        };
        if (branch) args.ref = branch;

        const rawResult = await this.mcp.callScmTool("get_file_contents", args);
        const result = parseGitLabFile(rawResult);
        if (typeof result === "string") return result;
        if (result?.content) {
            if (result.encoding === "base64") {
                return Buffer.from(result.content, "base64").toString("utf-8");
            }
            return result.content;
        }
        return JSON.stringify(result);
    }

    async listFiles(repo: string, path?: string, branch?: string): Promise<string[]> {
        const projectPath = encodeURIComponent(repo);
        const args: Record<string, unknown> = {
            project_id: projectPath,
            path: path ?? "",
        };
        if (branch) args.ref = branch;

        const rawResult = await this.mcp.callScmTool("list_repository_tree", args);
        try {
            const result = parseGitLabFileList(rawResult);
            return result.filter((f) => f.type === "blob").map((f) => f.path ?? f.name ?? "");
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
        const projectPath = encodeURIComponent(repo);
        await this.mcp.callScmTool("create_branch", {
            project_id: projectPath,
            branch: branchName,
            ref: baseBranch ?? "main",
        });
        log.info(`Created branch ${branchName}`);
    }

    async writeFile(repo: string, path: string, content: string, message: string, branch: string): Promise<void> {
        const projectPath = encodeURIComponent(repo);
        await this.mcp.callScmTool("create_or_update_file", {
            project_id: projectPath,
            file_path: path,
            content,
            commit_message: message,
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
        const projectPath = encodeURIComponent(repo);
        const rawResult = await this.mcp.callScmTool("create_merge_request", {
            project_id: projectPath,
            title,
            description: body,
            source_branch: sourceBranch,
            target_branch: targetBranch ?? "main",
        });
        const result = parseGitLabMergeRequest(rawResult);

        const prUrl = result?.web_url ?? result?.url ?? "";
        log.info(`Created MR: ${prUrl}`);
        return prUrl;
    }
}
