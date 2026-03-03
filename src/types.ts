/**
 * Shared type definitions used across the entire system.
 */

// ─── Jira ────────────────────────────────────────────────────

export interface JiraIssue {
    key: string;
    summary: string;
    description: string;
    status: string;
    issueType: string;
    assignee: string;
    repository: string | null;
    /** Raw fields object from MCP */
    raw?: Record<string, unknown>;
}

// ─── SCM ─────────────────────────────────────────────────────

export interface ScmFile {
    path: string;
    content: string;
}

export interface RepoInfo {
    name: string;
    defaultBranch: string;
    description?: string;
}

// ─── Pipeline Context ────────────────────────────────────────

export interface TaskContext {
    issue: JiraIssue;
    repo: RepoInfo;
    sourceFiles: ScmFile[];
    testFiles: ScmFile[];
}

// ─── AI ──────────────────────────────────────────────────────

export interface AiAnalysis {
    summary: string;
    plan: string;
    /** Files to modify / create with their new content */
    patches: AiPatch[];
    /** Shell commands to run for testing */
    commands: string[];
}

export interface AiPatch {
    path: string;
    /** Full new content of the file */
    content: string;
    action: "create" | "modify" | "delete";
}

// ─── Executor ────────────────────────────────────────────────

export interface ExecutionResult {
    success: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    duration_ms: number;
    /** Commands that were actually run */
    commands: string[];
    /** Commands that were blocked by policy */
    blocked: string[];
}

// ─── State ───────────────────────────────────────────────────

export type IssueStatus = "pending" | "processing" | "success" | "failed" | "approval_pending";

export interface IssueState {
    issueKey: string;
    status: IssueStatus;
    lastProcessedAt: string;
    attemptCount: number;
    prUrl: string | null;
    errorMessage: string | null;
    lockedAt: string | null;
}

// ─── Pipeline Result ─────────────────────────────────────────

export interface PipelineResult {
    issueKey: string;
    success: boolean;
    analysis: AiAnalysis | null;
    execution: ExecutionResult | null;
    prUrl: string | null;
    error: string | null;
    duration_ms: number;
}

// ─── External API DTOs ────────────────────────────────────────

export interface JiraRawIssue {
    key?: string;
    issue_key?: string;
    summary?: string;
    description?: string | null;
    status?: { name?: string } | null;
    issue_type?: { name?: string } | null;
    issuetype?: { name?: string } | null;
    assignee?: { display_name?: string; name?: string; displayName?: string } | null;
    fields?: {
        summary?: string;
        description?: string | null;
        status?: { name?: string } | null;
        issuetype?: { name?: string } | null;
        assignee?: { display_name?: string; name?: string; displayName?: string } | null;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface JiraRawSearchResponse {
    issues?: JiraRawIssue[];
    result?: { issues?: JiraRawIssue[] };
    [key: string]: unknown;
}

export interface GitHubRawRepo {
    full_name?: string;
    default_branch?: string;
    description?: string;
    [key: string]: unknown;
}

export interface GitHubRawFile {
    content?: string;
    encoding?: string;
    path?: string;
    name?: string;
    [key: string]: unknown;
}

export interface GitHubRawPullRequest {
    html_url?: string;
    url?: string;
    [key: string]: unknown;
}

export interface GitLabRawProject {
    path_with_namespace?: string;
    default_branch?: string;
    description?: string;
    [key: string]: unknown;
}

export interface GitLabRawFile {
    content?: string;
    encoding?: string;
    path?: string;
    name?: string;
    type?: string;
    [key: string]: unknown;
}

export interface GitLabRawMergeRequest {
    web_url?: string;
    url?: string;
    [key: string]: unknown;
}

export interface BitbucketRawSearchResponse {
    values?: BitbucketRawRepo[];
    [key: string]: unknown;
}

export interface BitbucketRawRepo {
    mainbranch?: { name?: string };
    description?: string;
    [key: string]: unknown;
}

export interface BitbucketRawFile {
    content?: string;
    [key: string]: unknown;
}

export interface BitbucketRawPullRequest {
    links?: { html?: { href?: string } };
    url?: string;
    [key: string]: unknown;
}
