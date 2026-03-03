/**
 * Jira MCP client wrapper — provides typed methods for Jira operations.
 */

import type { Config } from "../config.js";
import { buildBotJql } from "../config.js";
import { parseJiraIssue, parseJiraSearchResponse } from "../validation/jira.js";
import type { McpManager } from "../mcp/manager.js";
import type { JiraIssue } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("jira:client");

export class JiraClient {
    constructor(
        private mcp: McpManager,
        private config: Config,
    ) { }

    /** Search issues assigned to the AI bot */
    async fetchBotIssues(limit = 20): Promise<JiraIssue[]> {
        const jql = buildBotJql(this.config);
        log.info(`Fetching bot issues with JQL: ${jql}`);

        const rawResult = await this.mcp.callJiraTool("jira_search", {
            jql,
            limit,
            fields: "summary,status,description,issuetype,assignee",
        });

        const result = parseJiraSearchResponse(rawResult);

        const issues = result?.issues ?? result?.result?.issues ?? [];
        return issues.map((i) => this.parseIssue(i));
    }

    /** Get a single issue by key */
    async getIssue(issueKey: string): Promise<JiraIssue> {
        log.debug(`Getting issue ${issueKey}`);
        const rawResult = await this.mcp.callJiraTool("jira_get_issue", {
            issue_key: issueKey,
        });

        const result = parseJiraIssue(rawResult);

        return this.parseIssue(result);
    }

    /** Read the repository field from an issue */
    async getRepositoryField(issueKey: string): Promise<string | null> {
        const fieldId = this.config.jiraRepoFieldId;

        if (fieldId) {
            const rawResult = await this.mcp.callJiraTool("jira_get_issue", {
                issue_key: issueKey,
            });
            const result = parseJiraIssue(rawResult);

            const value =
                result?.fields?.[fieldId] ??
                result?.[fieldId] ??
                null;

            if (value) {
                return normalizeRepoUrl(typeof value === "string" ? value : JSON.stringify(value));
            }
        }

        // Fallback: parse from description
        const issue = await this.getIssue(issueKey);
        const parsed = parseRepoFromDescription(issue.description);
        if (parsed) return parsed;

        log.warn(`No repository found for ${issueKey}`);
        return null;
    }

    /** Add a comment to an issue */
    async addComment(issueKey: string, body: string): Promise<void> {
        log.info(`Adding comment to ${issueKey}`);
        await this.mcp.callJiraTool("jira_add_comment", {
            issue_key: issueKey,
            body,
        });
    }

    /** Transition an issue to a new status */
    async transitionIssue(issueKey: string, targetStatus: string): Promise<void> {
        log.info(`Transitioning ${issueKey} to "${targetStatus}"`);
        try {
            await this.mcp.callJiraTool("jira_transition_issue", {
                issue_key: issueKey,
                target_status: targetStatus,
            });
        } catch (e) {
            log.warn(`Failed to transition ${issueKey}: ${String(e)}`);
        }
    }

    /** Update an issue field */
    async updateIssue(issueKey: string, fields: Record<string, unknown>): Promise<void> {
        await this.mcp.callJiraTool("jira_update_issue", {
            issue_key: issueKey,
            fields: JSON.stringify(fields),
        });
    }

    private parseIssue(rawUnsafe: unknown): JiraIssue {
        const raw = parseJiraIssue(rawUnsafe);
        return {
            key: raw.key ?? raw.issue_key ?? "?",
            summary: raw.summary ?? raw.fields?.summary ?? "",
            description: raw.description ?? raw.fields?.description ?? "",
            status: raw.status?.name ?? raw.fields?.status?.name ?? "Unknown",
            issueType: raw.issue_type?.name ?? raw.issuetype?.name ?? raw.fields?.issuetype?.name ?? "Unknown",
            assignee:
                raw.assignee?.display_name ??
                raw.assignee?.name ??
                raw.fields?.assignee?.displayName ??
                "Unassigned",
            repository: null, // Filled separately
            raw,
        };
    }
}

// ─── Helpers ─────────────────────────────────────────────────

/** Normalize repository URL to org/repo format */
export function normalizeRepoUrl(input: string): string {
    const trimmed = input.trim();

    // Already in org/repo format
    if (/^[\w.-]+\/[\w.-]+(\/[\w.-]+)*$/.test(trimmed)) {
        return trimmed;
    }

    // Extract from URL (GitHub/GitLab/Bitbucket)
    try {
        const url = new URL(trimmed);
        const path = url.pathname.replace(/^\//, "").replace(/\.git$/, "").replace(/\/$/, "");
        if (path) return path;
    } catch {
        // Not a URL
    }

    return trimmed;
}

/** Try to parse repository from issue description */
function parseRepoFromDescription(description: string): string | null {
    if (!description) return null;

    // Match patterns like "Repo: org/repo" or "Repository: https://github.com/org/repo"
    const patterns = [
        /Repo:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i,
        /Repository:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i,
        /(?:Repo|Repository):\s*(https?:\/\/[^\s]+)/i,
        /(?:github|gitlab|bitbucket)\.(?:com|org)\/([^\s]+)/i,
    ];

    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match?.[1]) {
            return normalizeRepoUrl(match[1]);
        }
    }

    return null;
}
