/**
 * Bitbucket SCM provider — uses Kallows/mcp-bitbucket tools.
 */

import type { ScmProvider } from "./provider.js";
import type { ScmFile, RepoInfo } from "../types.js";
import type { McpManager } from "../mcp/manager.js";
import type { Config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("scm:bitbucket");

export class BitbucketProvider implements ScmProvider {
    private workspace: string;
    private username: string;
    private appPassword: string;
    private email: string;
    private apiToken: string;

    constructor(
        private mcp: McpManager,
        config: Config,
    ) {
        this.workspace = config.bitbucketWorkspace ?? "";
        this.username = config.bitbucketUsername ?? "";
        this.appPassword = config.bitbucketAppPassword ?? "";
        this.email = config.bitbucketEmail ?? "";
        this.apiToken = config.bitbucketApiToken ?? "";
    }

    async getRepoInfo(repo: string): Promise<RepoInfo> {
        const { workspace, slug } = this.parseRepo(repo);
        const result = await this.bitbucketJson<{
            full_name?: string;
            description?: string | null;
            mainbranch?: { name?: string };
        }>(`/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}`);

        return {
            name: `${workspace}/${slug}`,
            defaultBranch: result.mainbranch?.name ?? "main",
            description: result.description ?? "",
        };
    }

    async readFile(repo: string, path: string, branch?: string): Promise<string> {
        const { workspace, slug } = this.parseRepo(repo);
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        return this.bitbucketText(`/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/src/${encodeURIComponent(branch ?? "main")}/${encodedPath}`);
    }

    async listFiles(repo: string, path?: string, branch?: string): Promise<string[]> {
        const { workspace, slug } = this.parseRepo(repo);
        if (!this.hasCredentials()) {
            log.warn("Bitbucket credentials are missing; cannot list files via Bitbucket API.");
            return [];
        }

        const ref = encodeURIComponent(branch ?? "main");
        const rootPath = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "/";
        const baseUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/src/${ref}${rootPath}`;

        // Try flat listing first: max_depth=10 returns all files in one paginated request
        const flatUrl = `${baseUrl}?pagelen=100&max_depth=10`;
        const flatFiles = await this.listFilesFlat(flatUrl);
        if (flatFiles.length > 0) {
            log.debug(`Bitbucket flat listing: ${flatFiles.length} files`);
            return flatFiles;
        }

        // Fallback to recursive traversal if flat listing returns nothing
        log.debug("Bitbucket flat listing returned 0 files, falling back to recursive traversal");
        return this.listFilesFromApi(`${baseUrl}?pagelen=100`);
    }

    /** Flat file listing using max_depth — paginated, no recursion needed */
    private async listFilesFlat(url: string): Promise<string[]> {
        const files: string[] = [];
        let nextUrl: string | undefined = url;

        while (nextUrl) {
            const response = await fetch(nextUrl, {
                headers: {
                    Authorization: this.authHeader(),
                    Accept: "application/json",
                },
            });

            if (!response.ok) {
                log.debug(`Bitbucket flat listing failed (${response.status}) — will fall back to recursive`);
                return [];
            }

            const page = asBitbucketSourcePage(await response.json());
            for (const entry of page.values) {
                // Only collect files, skip directories
                if (entry.path && entry.type === "commit_file") {
                    files.push(entry.path);
                }
            }
            nextUrl = page.next;
        }

        return [...new Set(files)];
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
        const base = baseBranch ?? "main";
        const branch = await this.bitbucketJson<{ target?: { hash?: string } }>(
            `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/refs/branches/${encodeURIComponent(base)}`
        );
        const hash = branch.target?.hash;
        if (!hash) throw new Error(`Could not resolve Bitbucket base branch ${base}`);

        await this.bitbucketJson(`/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/refs/branches`, {
            method: "POST",
            json: {
                name: branchName,
                target: { hash },
            },
        });
        log.info(`Created branch ${branchName}`);
    }

    async writeFile(repo: string, path: string, content: string, message: string, branch: string): Promise<void> {
        const { workspace, slug } = this.parseRepo(repo);
        const form = new FormData();
        form.append("branch", branch);
        form.append("message", message);
        form.append(path, content);
        await this.bitbucketJson(`/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/src`, {
            method: "POST",
            body: form,
            allowEmpty: true,
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
        const result = await this.bitbucketJson<{ links?: { html?: { href?: string } }; url?: string }>(
            `/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(slug)}/pullrequests`,
            {
                method: "POST",
                json: {
                    title,
                    description: body,
                    source: { branch: { name: sourceBranch } },
                    destination: { branch: { name: targetBranch ?? "main" } },
                },
            }
        );

        const prUrl = result.links?.html?.href ?? result.url ?? "";
        if (!prUrl) {
            throw new Error("Bitbucket PR was created but no URL was returned");
        }
        log.info(`Created PR: ${prUrl}`);
        return prUrl;
    }

    private async bitbucketJson<T = unknown>(
        path: string,
        options: { method?: string; json?: unknown; body?: BodyInit; allowEmpty?: boolean } = {},
    ): Promise<T> {
        const headers: Record<string, string> = {
            Authorization: this.authHeader(),
            Accept: "application/json",
        };
        let body = options.body;
        if (options.json !== undefined) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(options.json);
        }

        const response = await fetch(`https://api.bitbucket.org/2.0${path}`, {
            method: options.method ?? "GET",
            headers,
            body,
        });

        if (!response.ok) {
            throw new Error(`Bitbucket API failed (${response.status} ${response.statusText}): ${await response.text()}`);
        }
        const text = await response.text();
        if (!text.trim()) {
            if (options.allowEmpty) return undefined as T;
            throw new Error(`Bitbucket API returned an empty response for ${path}`);
        }
        return JSON.parse(text) as T;
    }

    private async bitbucketText(path: string): Promise<string> {
        const response = await fetch(`https://api.bitbucket.org/2.0${path}`, {
            headers: {
                Authorization: this.authHeader(),
                Accept: "text/plain, application/octet-stream, */*",
            },
        });
        if (!response.ok) {
            throw new Error(`Bitbucket API failed (${response.status} ${response.statusText}): ${await response.text()}`);
        }
        return response.text();
    }

    private authHeader(): string {
        const user = this.apiToken ? this.email : this.username;
        const secret = this.apiToken || this.appPassword;
        return `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`;
    }

    private hasCredentials(): boolean {
        return Boolean((this.apiToken && this.email) || (this.username && this.appPassword));
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

    private async listFilesFromApi(url: string, depth = 0): Promise<string[]> {
        if (depth > 10) return [];

        const files: string[] = [];
        let nextUrl: string | undefined = url;

        while (nextUrl) {
            const response = await fetch(nextUrl, {
                headers: {
                    Authorization: this.authHeader(),
                    Accept: "application/json",
                },
            });

            if (!response.ok) {
                log.warn(`Bitbucket file listing failed (${response.status}): ${response.statusText}`);
                return files;
            }

            const page = asBitbucketSourcePage(await response.json());
            for (const entry of page.values) {
                if (!entry.path) continue;
                if (entry.type === "commit_directory") {
                    files.push(...await this.listFilesFromApi(entry.links?.self?.href ?? `${url.replace(/\?.*$/, "")}/${entry.path}?pagelen=100`, depth + 1));
                } else if (entry.type === "commit_file") {
                    files.push(entry.path);
                }
            }

            nextUrl = page.next;
        }

        return [...new Set(files)];
    }
}

interface BitbucketSourceEntry {
    type?: string;
    path?: string;
    links?: {
        self?: {
            href?: string;
        };
    };
}

interface BitbucketSourcePage {
    values: BitbucketSourceEntry[];
    next?: string;
}

function asBitbucketSourcePage(value: unknown): BitbucketSourcePage {
    if (!value || typeof value !== "object") return { values: [] };
    const record = value as Record<string, unknown>;
    const rawValues = Array.isArray(record.values) ? record.values : [];
    const values = rawValues
        .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
        .map((entry) => ({
            type: typeof entry.type === "string" ? entry.type : undefined,
            path: typeof entry.path === "string" ? entry.path : undefined,
            links: parseLinks(entry.links),
        }));

    return {
        values,
        next: typeof record.next === "string" ? record.next : undefined,
    };
}

function parseLinks(value: unknown): BitbucketSourceEntry["links"] {
    if (!value || typeof value !== "object") return undefined;
    const links = value as Record<string, unknown>;
    const self = links.self;
    if (!self || typeof self !== "object") return undefined;
    const href = (self as Record<string, unknown>).href;
    return typeof href === "string" ? { self: { href } } : undefined;
}
