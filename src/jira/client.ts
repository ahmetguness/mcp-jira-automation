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
    private cachedRepoFieldId: string | null = null;

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

    /** Auto-detect repository custom field ID */
    private async detectRepositoryFieldId(): Promise<string | null> {
        if (this.cachedRepoFieldId) {
            return this.cachedRepoFieldId;
        }

        try {
            log.info("Auto-detecting repository custom field...");
            
            // Get all fields from Jira
            const rawResult = await this.mcp.callJiraTool("jira_get_fields", {});
            const fields = Array.isArray(rawResult) ? rawResult : [];

            // Search for fields with "repository" or "repo" in name (case-insensitive)
            const repoField = fields.find((field: unknown) => {
                if (!field || typeof field !== 'object') return false;
                const fieldObj = field as Record<string, unknown>;
                const name = typeof fieldObj.name === 'string' ? fieldObj.name.toLowerCase() : '';
                const id = typeof fieldObj.id === 'string' ? fieldObj.id : '';
                return (
                    id.startsWith("customfield_") &&
                    (name.includes("repository") || name.includes("repo"))
                );
            });

            if (repoField && typeof repoField === 'object') {
                const fieldObj = repoField as Record<string, unknown>;
                const fieldId = typeof fieldObj.id === 'string' ? fieldObj.id : null;
                const fieldName = typeof fieldObj.name === 'string' ? fieldObj.name : 'Unknown';
                
                if (fieldId) {
                    this.cachedRepoFieldId = fieldId;
                    log.info(`Auto-detected repository field: ${fieldName} (${fieldId})`);
                    return fieldId;
                }
            }

            log.warn("No repository custom field found. Please create a custom field named 'Repository'");
            return null;
        } catch (error) {
            log.warn(`Failed to auto-detect repository field: ${String(error)}`);
            return null;
        }
    }

    /** Read the repository field from an issue */
    async getRepositoryField(issueKey: string): Promise<string | null> {
        // Try configured field ID first
        let fieldId = this.config.jiraRepoFieldId;

        // If not configured, try auto-detection
        if (!fieldId || fieldId === "customfield_XXXXX") {
            fieldId = await this.detectRepositoryFieldId() || undefined;
        }

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
        if (parsed) {
            log.info(`Repository found in description: ${parsed}`);
            return parsed;
        }

        log.warn(`No repository found for ${issueKey}. Add repository to description in format: "Repository: username/repo" or "https://github.com/username/repo"`);
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
        // Explicit patterns with labels
        /(?:Repo|Repository):\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/i,
        /(?:Repo|Repository):\s*(https?:\/\/[^\s]+)/i,
        
        // GitHub/GitLab/Bitbucket URLs anywhere in text
        /(?:github|gitlab|bitbucket)\.(?:com|org)\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/i,
        
        // Standalone org/repo pattern (more permissive)
        /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)\b/,
    ];

    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match?.[1]) {
            const normalized = normalizeRepoUrl(match[1]);
            // Validate it looks like a real repo (has at least one slash)
            if (normalized.includes('/')) {
                return normalized;
            }
        }
    }

    return null;
}
