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
        log.debug(`JQL: ${jql}`);

        const rawResult = await this.mcp.callJiraTool("jira_search", {
            jql,
            limit,
        });

        log.debug(`Raw jira_search response: ${JSON.stringify(rawResult).slice(0, 500)}`);

        const result = parseJiraSearchResponse(rawResult);

        const issues = result?.issues ?? result?.result?.issues ?? [];
        log.debug(`Parsed issue count: ${issues.length}`);
        return issues.map((i) => this.parseIssue(i));
    }

    /** Get a single issue by key */
    async getIssue(issueKey: string, fields?: string): Promise<JiraIssue> {
        log.debug(`Getting issue ${issueKey}`);
        const params: { issue_key: string; fields?: string } = {
            issue_key: issueKey,
        };
        
        if (fields) {
            params.fields = fields;
        }
        
        const rawResult = await this.mcp.callJiraTool("jira_get_issue", params);

        const result = parseJiraIssue(rawResult);

        return this.parseIssue(result);
    }

    /** Auto-detect repository custom field ID */
    private async detectRepositoryFieldId(): Promise<string | null> {
        if (this.cachedRepoFieldId) {
            return this.cachedRepoFieldId;
        }

        try {
            log.debug("Auto-detecting repository custom field...");
            
            // Try searching for "repository" first
            let rawResult = await this.mcp.callJiraTool("jira_search_fields", {
                keyword: "repository",
            });
            
            let fields: unknown[] = Array.isArray(rawResult) ? rawResult : 
                        (rawResult && typeof rawResult === 'object' && 'fields' in rawResult) ? 
                        (rawResult as { fields: unknown }).fields as unknown[] : [];
            
            if (!Array.isArray(fields)) {
                fields = [];
            }

            // If no results, try "repo" as well
            if (fields.length === 0) {
                rawResult = await this.mcp.callJiraTool("jira_search_fields", {
                    keyword: "repo",
                });
                
                fields = Array.isArray(rawResult) ? rawResult : 
                        (rawResult && typeof rawResult === 'object' && 'fields' in rawResult) ? 
                        (rawResult as { fields: unknown }).fields as unknown[] : [];
                
                if (!Array.isArray(fields)) {
                    fields = [];
                }
            }

            // Search for custom fields with "repository" or "repo" in name
            const repoField = fields.find((field: unknown) => {
                if (!field || typeof field !== 'object') return false;
                const fieldObj = field as Record<string, unknown>;
                const name = typeof fieldObj.name === 'string' ? fieldObj.name.toLowerCase() : '';
                const id = typeof fieldObj.id === 'string' ? fieldObj.id : '';
                const isCustom = typeof fieldObj.custom === 'boolean' ? fieldObj.custom : id.startsWith("customfield_");
                
                return isCustom && (name.includes("repository") || name.includes("repo"));
            });

            if (repoField && typeof repoField === 'object') {
                const fieldObj = repoField as Record<string, unknown>;
                const fieldId = typeof fieldObj.id === 'string' ? fieldObj.id : null;
                const fieldName = typeof fieldObj.name === 'string' ? fieldObj.name : 'Unknown';
                
                if (fieldId) {
                    this.cachedRepoFieldId = fieldId;
                    log.info(`Repository field: ${fieldName} (${fieldId})`);
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
            log.debug(`Fetching ${issueKey} custom field ${fieldId}`);
            const rawResult = await this.mcp.callJiraTool("jira_get_issue", {
                issue_key: issueKey,
                fields: fieldId,
            });
            log.debug(`Raw result from jira_get_issue: ${JSON.stringify(rawResult)}`);
            const result = parseJiraIssue(rawResult);

            const value =
                result?.fields?.[fieldId] ??
                result?.[fieldId] ??
                null;

            if (value) {
                log.debug(`Found repository in custom field ${fieldId}: ${JSON.stringify(value)}`);
                
                // Handle different value formats from Jira
                let repoValue: string;
                if (typeof value === "string") {
                    repoValue = value;
                } else if (value && typeof value === "object" && "value" in value) {
                    // Handle Jira select field format: {value: "owner/repo"}
                    repoValue = String((value as { value: unknown }).value);
                    log.debug(`Extracted repository value from Jira select field: ${repoValue}`);
                } else {
                    // Fallback: stringify the object
                    repoValue = JSON.stringify(value);
                    log.warn(`Repository field has unexpected format: ${repoValue}`);
                }
                
                return normalizeRepoUrl(repoValue);
            } else {
                log.warn(`Custom field ${fieldId} exists but has no value or was not returned by API`);
            }
        } else {
            log.info("No repository custom field configured or detected, falling back to description parsing");
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

    // ─── Base URL Field ─────────────────────────────────────

    private cachedBaseUrlFieldId: string | null = null;

    /** Auto-detect the "Base URL" or "API URL" custom field */
    private async detectBaseUrlFieldId(): Promise<string | null> {
        if (this.cachedBaseUrlFieldId) return this.cachedBaseUrlFieldId;

        try {
            log.debug("Auto-detecting base URL custom field...");
            const rawResult = await this.mcp.callJiraTool("jira_search_fields", {
                keyword: "base url",
            });

            let fields: unknown[] = Array.isArray(rawResult) ? rawResult :
                (rawResult && typeof rawResult === 'object' && 'fields' in rawResult) ?
                    (rawResult as { fields: unknown }).fields as unknown[] : [];
            if (!Array.isArray(fields)) fields = [];

            // Also try "api url" if nothing found
            if (fields.length === 0) {
                const rawResult2 = await this.mcp.callJiraTool("jira_search_fields", {
                    keyword: "api url",
                });
                fields = Array.isArray(rawResult2) ? rawResult2 :
                    (rawResult2 && typeof rawResult2 === 'object' && 'fields' in rawResult2) ?
                        (rawResult2 as { fields: unknown }).fields as unknown[] : [];
                if (!Array.isArray(fields)) fields = [];
            }

            const urlField = fields.find((field: unknown) => {
                if (!field || typeof field !== 'object') return false;
                const f = field as Record<string, unknown>;
                const name = typeof f.name === 'string' ? f.name.toLowerCase() : '';
                const id = typeof f.id === 'string' ? f.id : '';
                const isCustom = typeof f.custom === 'boolean' ? f.custom : id.startsWith("customfield_");
                return isCustom && (name.includes("base url") || name.includes("base_url") || name.includes("api url") || name.includes("api_url"));
            });

            if (urlField && typeof urlField === 'object') {
                const f = urlField as Record<string, unknown>;
                const fieldId = typeof f.id === 'string' ? f.id : null;
                const fieldName = typeof f.name === 'string' ? f.name : 'Unknown';
                if (fieldId) {
                    this.cachedBaseUrlFieldId = fieldId;
                    log.info(`Base URL field: ${fieldName} (${fieldId})`);
                    return fieldId;
                }
            }

            log.debug("No base URL custom field found (optional)");
            return null;
        } catch (error) {
            log.debug(`Failed to auto-detect base URL field: ${String(error)}`);
            return null;
        }
    }

    /**
     * Read base URL from Jira custom field, then fall back to description.
     * Priority: custom field > description pattern
     */
    async getBaseUrlField(issueKey: string, description: string): Promise<string | null> {
        let fieldId = this.config.jiraBaseUrlFieldId;

        if (!fieldId) {
            fieldId = await this.detectBaseUrlFieldId() || undefined;
        }

        if (fieldId) {
            try {
                const rawResult = await this.mcp.callJiraTool("jira_get_issue", {
                    issue_key: issueKey,
                    fields: fieldId,
                });

                const result = parseJiraIssue(rawResult);
                const value = result?.fields?.[fieldId] ?? result?.[fieldId] ?? null;

                if (value) {
                    let urlValue: string;
                    if (typeof value === 'string') {
                        urlValue = value;
                    } else if (value && typeof value === 'object' && 'value' in value) {
                        urlValue = String((value as { value: unknown }).value);
                    } else {
                        urlValue = String(value);
                    }

                    urlValue = urlValue.trim().replace(/\/+$/, "");
                    if (urlValue && urlValue.startsWith("http")) {
                        log.info(`Base URL from custom field: ${urlValue}`);
                        return urlValue;
                    }
                }
            } catch (error) {
                log.debug(`Failed to read base URL field for ${issueKey}: ${String(error)}`);
            }
        }

        // Fallback: parse from description
        if (description) {
            const patterns = [
                /base[_\s-]?url\s*[:=]\s*(https?:\/\/[^\s\n]+)/i,
                /api[_\s-]?base[_\s-]?url\s*[:=]\s*(https?:\/\/[^\s\n]+)/i,
                /target[_\s-]?url\s*[:=]\s*(https?:\/\/[^\s\n]+)/i,
            ];
            for (const pattern of patterns) {
                const match = description.match(pattern);
                if (match?.[1]) {
                    const url = match[1].trim().replace(/\/+$/, "");
                    log.info(`Base URL from description: ${url}`);
                    return url;
                }
            }
        }

        return null;
    }

    // ─── Credentials Field ───────────────────────────────────

    private cachedCredentialsFieldId: string | null = null;

    /** Auto-detect the "Credentials" or "API Credentials" custom field */
    private async detectCredentialsFieldId(): Promise<string | null> {
        if (this.cachedCredentialsFieldId) return this.cachedCredentialsFieldId;

        try {
            log.debug("Auto-detecting credentials custom field...");
            const rawResult = await this.mcp.callJiraTool("jira_search_fields", {
                keyword: "credentials",
            });

            let fields: unknown[] = Array.isArray(rawResult) ? rawResult :
                (rawResult && typeof rawResult === 'object' && 'fields' in rawResult) ?
                    (rawResult as { fields: unknown }).fields as unknown[] : [];
            if (!Array.isArray(fields)) fields = [];

            const credField = fields.find((field: unknown) => {
                if (!field || typeof field !== 'object') return false;
                const f = field as Record<string, unknown>;
                const name = typeof f.name === 'string' ? f.name.toLowerCase() : '';
                const id = typeof f.id === 'string' ? f.id : '';
                const isCustom = typeof f.custom === 'boolean' ? f.custom : id.startsWith("customfield_");
                return isCustom && (name.includes("credentials") || name.includes("api key") || name.includes("api_key"));
            });

            if (credField && typeof credField === 'object') {
                const f = credField as Record<string, unknown>;
                const fieldId = typeof f.id === 'string' ? f.id : null;
                const fieldName = typeof f.name === 'string' ? f.name : 'Unknown';
                if (fieldId) {
                    this.cachedCredentialsFieldId = fieldId;
                    log.info(`Credentials field: ${fieldName} (${fieldId})`);
                    return fieldId;
                }
            }

            log.debug("No credentials custom field found (optional — tests will run without extra credentials)");
            return null;
        } catch (error) {
            log.debug(`Failed to auto-detect credentials field: ${String(error)}`);
            return null;
        }
    }

    /**
     * Read credentials from the Jira custom field.
     * Expected format (multi-line text):
     *   API_KEY=sk-xxx
     *   BEARER_TOKEN=eyJhbG...
     *
     * Returns a key-value map. Values are NEVER logged.
     */
    async getCredentialsField(issueKey: string): Promise<Record<string, string>> {
        let fieldId = this.config.jiraCredentialsFieldId;

        if (!fieldId) {
            fieldId = await this.detectCredentialsFieldId() || undefined;
        }

        if (!fieldId) return {};

        try {
            const rawResult = await this.mcp.callJiraTool("jira_get_issue", {
                issue_key: issueKey,
                fields: fieldId,
            });

            const result = parseJiraIssue(rawResult);
            const value = result?.fields?.[fieldId] ?? result?.[fieldId] ?? null;

            if (!value) return {};

            const text = typeof value === 'string' ? value :
                (value && typeof value === 'object' && 'value' in value) ? String((value as { value: unknown }).value) :
                    typeof value === 'object' ? JSON.stringify(value) : String(value);

            // Parse KEY=VALUE lines
            const credentials: Record<string, string> = {};
            for (const line of text.split(/[\r\n]+/)) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx <= 0) continue;
                const key = trimmed.slice(0, eqIdx).trim();
                const val = trimmed.slice(eqIdx + 1).trim();
                if (key && val) {
                    credentials[key] = val;
                }
            }

            if (Object.keys(credentials).length > 0) {
                log.info(`Credentials loaded for ${issueKey}: ${Object.keys(credentials).join(', ')} (values redacted)`);
            }

            return credentials;
        } catch (error) {
            log.warn(`Failed to read credentials for ${issueKey}: ${String(error)}`);
            return {};
        }
    }

    /** Add a comment to an issue */
    async addComment(issueKey: string, body: string): Promise<void> {
        log.debug(`Adding comment to ${issueKey}`);
        await this.mcp.callJiraTool("jira_add_comment", {
            issue_key: issueKey,
            body,
        });
    }

    /** Transition an issue to a new status */
    async transitionIssue(issueKey: string, targetStatus: string): Promise<void> {
        log.info(`Transitioning ${issueKey} to "${targetStatus}"`);
        try {
            // First, get available transitions to find the correct transition_id
            let transitions: Array<{ id: string; name: string; to?: { name?: string } }> = [];
            try {
                const rawTransitions = await this.mcp.callJiraTool("jira_get_transitions", {
                    issue_key: issueKey,
                });

                // Parse transitions — expect array of { id, name, to: { name } }
                if (Array.isArray(rawTransitions)) {
                    transitions = rawTransitions as typeof transitions;
                } else if (rawTransitions && typeof rawTransitions === "object") {
                    const obj = rawTransitions as Record<string, unknown>;
                    if (Array.isArray(obj.transitions)) {
                        transitions = obj.transitions as typeof transitions;
                    }
                }
            } catch (fetchErr) {
                // If jira_get_transitions doesn't exist, try direct transition with transition_id guess
                log.debug(`jira_get_transitions failed: ${String(fetchErr)}. Trying common transition IDs.`);
                // Common Jira transition IDs: 31 = Done, 21 = In Progress, 11 = To Do
                const commonIds = targetStatus.toLowerCase() === "done" ? ["31", "41", "51"] : ["21", "31"];
                for (const tid of commonIds) {
                    try {
                        await this.mcp.callJiraTool("jira_transition_issue", {
                            issue_key: issueKey,
                            transition_id: tid,
                        });
                        log.info(`Transitioned ${issueKey} with transition_id ${tid}`);
                        return;
                    } catch {
                        // Try next ID
                    }
                }
                log.warn(`Failed to transition ${issueKey}: no valid transition_id found`);
                return;
            }

            // Find transition matching target status (case-insensitive)
            const target = targetStatus.toLowerCase();
            const match = transitions.find(
                (t) =>
                    t.name?.toLowerCase() === target ||
                    t.to?.name?.toLowerCase() === target,
            );

            if (!match) {
                const available = transitions.map((t) => t.to?.name ?? t.name).join(", ");
                log.warn(`No transition to "${targetStatus}" for ${issueKey}. Available: ${available}`);
                return;
            }

            await this.mcp.callJiraTool("jira_transition_issue", {
                issue_key: issueKey,
                transition_id: match.id,
            });
            log.info(`Transitioned ${issueKey} to "${targetStatus}" (transition_id: ${match.id})`);
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
