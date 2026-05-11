import { z } from "zod";
import { createLogger } from "./logger.js";

const log = createLogger("config");

// ─── Schema ──────────────────────────────────────────────────

const configSchema = z.object({
    // Jira
    jiraBaseUrl: z.string().min(1, "JIRA_BASE_URL is required"),
    jiraEmail: z.string().min(1, "JIRA_EMAIL is required"),
    jiraApiToken: z.string().min(1, "JIRA_API_TOKEN is required"),
    jiraProjectKey: z.string().min(1, "JIRA_PROJECT_KEY is required"),
    jiraBotDisplayName: z.string().default("AI Cyber Bot"),
    jiraRepoFieldId: z.string().optional(),
    jiraCredentialsFieldId: z.string().optional(),
    jiraBaseUrlFieldId: z.string().optional(),
    jqlOverride: z.string().optional(),

    // Listener
    mode: z.enum(["poll", "webhook"]).default("poll"),
    pollIntervalMs: z.coerce.number().int().min(5000).default(15000),
    webhookPort: z.coerce.number().int().default(3000),

    // SCM
    scmProvider: z.enum(["github", "gitlab", "bitbucket"]),
    // GitHub
    githubToken: z.string().optional(),
    // GitLab
    gitlabToken: z.string().optional(),
    gitlabUrl: z.string().default("https://gitlab.com"),
    // Bitbucket
    bitbucketUsername: z.string().optional(),
    bitbucketAppPassword: z.string().optional(),
    bitbucketWorkspace: z.string().optional(),

    // AI
    aiProvider: z.enum(["openai", "anthropic", "gemini", "vllm", "aider"]),
    aiModel: z.string().optional(),
    openaiApiKey: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    geminiApiKey: z.string().optional(),
    vllmBaseUrl: z.string().optional(),
    vllmModel: z.string().optional(),

    // Aider
    aiderModel: z.string().optional(),
    aiderPath: z.string().default("aider"),

    // Execution Mode
    executionMode: z.enum(["remote", "sandbox"]).default("remote"),
    apiBaseUrl: z.string().optional(),

    // Executor
    executorBackend: z.enum(["local", "ssh"]).default("local"),
    execPolicy: z.enum(["strict", "permissive"]).default("strict"),
    execTimeoutMs: z.coerce.number().int().default(300_000), // 5 min
    dockerImage: z.string().default("auto"),
    allowInstallScripts: z.coerce.boolean().default(false),

    // SSH executor
    sshHost: z.string().optional(),
    sshPort: z.coerce.number().int().default(22),
    sshUser: z.string().optional(),
    sshPrivateKeyPath: z.string().optional(),
    sshRemoteWorkdir: z.string().default("/tmp/mcp-jira-automation"),
    sshConnectTimeoutMs: z.coerce.number().int().default(15_000),
    sshCleanupWorkspace: z.coerce.boolean().default(true),
    sshRemoveImage: z.coerce.boolean().default(false),

    // Container test environment overrides (comma-separated KEY=VALUE pairs)
    containerTestEnv: z.string().optional(),

    // Webhook security
    webhookSecret: z.string().optional(),

    // MCP server paths
    mcpAtlassianUrl: z.string().default("http://127.0.0.1:9000/sse"),

    // PR & Branch
    requireApproval: z.coerce.boolean().default(false),

    // Logging
    logLevel: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),

    // State
    stateFile: z.string().default("./data/state.json"),
    maxAttempts: z.coerce.number().int().default(3),
}).superRefine((config, ctx) => {
    if (config.executorBackend !== "ssh") return;

    if (!config.sshHost) {
        ctx.addIssue({
            code: "custom",
            path: ["sshHost"],
            message: "SSH_HOST is required when EXECUTOR_BACKEND=ssh",
        });
    }

    if (!config.sshUser) {
        ctx.addIssue({
            code: "custom",
            path: ["sshUser"],
            message: "SSH_USER is required when EXECUTOR_BACKEND=ssh",
        });
    }

    if (!config.sshRemoteWorkdir.startsWith("/")) {
        ctx.addIssue({
            code: "custom",
            path: ["sshRemoteWorkdir"],
            message: "SSH_REMOTE_WORKDIR must be an absolute POSIX path",
        });
    }
});

export type Config = z.infer<typeof configSchema>;

// ─── Loader ──────────────────────────────────────────────────

export function loadConfig(): Config {
    const raw = {
        // Jira
        jiraBaseUrl: process.env.JIRA_BASE_URL ?? "",
        jiraEmail: process.env.JIRA_EMAIL ?? "",
        jiraApiToken: process.env.JIRA_API_TOKEN ?? "",
        jiraProjectKey: process.env.JIRA_PROJECT_KEY ?? "",
        jiraBotDisplayName: process.env.JIRA_AI_BOT_DISPLAY_NAME ?? "AI Cyber Bot",
        jiraRepoFieldId: process.env.JIRA_REPO_FIELD_ID || undefined,
        jiraCredentialsFieldId: process.env.JIRA_CREDENTIALS_FIELD_ID || undefined,
        jiraBaseUrlFieldId: process.env.JIRA_BASE_URL_FIELD_ID || undefined,
        jqlOverride: process.env.JQL_ASSIGNED_TO_BOT || undefined,

        // Listener
        mode: process.env.MODE ?? "poll",
        pollIntervalMs: process.env.POLL_INTERVAL_MS ?? "15000",
        webhookPort: process.env.WEBHOOK_PORT ?? "3000",

        // SCM
        scmProvider: process.env.SCM_PROVIDER ?? "github",
        githubToken: process.env.GITHUB_TOKEN || undefined,
        gitlabToken: process.env.GITLAB_TOKEN || undefined,
        gitlabUrl: process.env.GITLAB_URL ?? "https://gitlab.com",
        bitbucketUsername: process.env.BITBUCKET_USERNAME || undefined,
        bitbucketAppPassword: process.env.BITBUCKET_APP_PASSWORD || undefined,
        bitbucketWorkspace: process.env.BITBUCKET_WORKSPACE || undefined,

        // AI
        aiProvider: process.env.AI_PROVIDER ?? "openai",
        aiModel: process.env.AI_MODEL || undefined,
        openaiApiKey: process.env.OPENAI_API_KEY || undefined,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
        geminiApiKey: process.env.GEMINI_API_KEY || undefined,
        vllmBaseUrl: process.env.VLLM_BASE_URL || undefined,
        vllmModel: process.env.VLLM_MODEL || undefined,

        // Aider
        aiderModel: process.env.AIDER_MODEL || undefined,
        aiderPath: process.env.AIDER_PATH ?? "aider",

        // Execution Mode
        executionMode: process.env.EXECUTION_MODE ?? "remote",
        apiBaseUrl: process.env.API_BASE_URL || undefined,

        // Executor
        executorBackend: process.env.EXECUTOR_BACKEND ?? "local",
        execPolicy: process.env.EXEC_POLICY ?? "strict",
        execTimeoutMs: process.env.EXEC_TIMEOUT_MS ?? "300000",
        dockerImage: process.env.DOCKER_IMAGE ?? "auto",
        allowInstallScripts: (process.env.ALLOW_INSTALL_SCRIPTS ?? "false").toLowerCase() === "true",

        // SSH executor
        sshHost: process.env.SSH_HOST || undefined,
        sshPort: process.env.SSH_PORT ?? "22",
        sshUser: process.env.SSH_USER || undefined,
        sshPrivateKeyPath: process.env.SSH_PRIVATE_KEY_PATH || undefined,
        sshRemoteWorkdir: process.env.SSH_REMOTE_WORKDIR ?? "/tmp/mcp-jira-automation",
        sshConnectTimeoutMs: process.env.SSH_CONNECT_TIMEOUT_MS ?? "15000",
        sshCleanupWorkspace: (process.env.SSH_CLEANUP_WORKSPACE ?? "true").toLowerCase() === "true",
        sshRemoveImage: (process.env.SSH_REMOVE_IMAGE ?? "false").toLowerCase() === "true",

        // Container test env overrides
        containerTestEnv: process.env.CONTAINER_TEST_ENV || undefined,

        // Webhook security
        webhookSecret: process.env.WEBHOOK_SECRET || undefined,

        // MCP
        mcpAtlassianUrl: process.env.MCP_SSE_URL ?? "http://127.0.0.1:9000/sse",

        // PR
        requireApproval: (process.env.REQUIRE_APPROVAL ?? "false").toLowerCase() === "true",

        // Logging
        logLevel: process.env.LOG_LEVEL ?? "info",

        // State
        stateFile: process.env.STATE_FILE ?? "./data/state.json",
        maxAttempts: process.env.MAX_ATTEMPTS ?? "3",
    };

    const result = configSchema.safeParse(raw);

    if (!result.success) {
        const errors = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join(" ");
        log.error("Config validation failed", { validationErrors: errors });
        throw new Error(`Invalid configuration: ${errors}`);
    }

    auditSecrets(result.data);

    // Warn if remote mode is active but no API_BASE_URL is configured
    if (result.data.executionMode === "remote" && !result.data.apiBaseUrl) {
        log.warn("EXECUTION_MODE=remote but API_BASE_URL is not set. Tests will fail unless base_url is provided in the Jira task description.");
    }

    return result.data;
}

/** Log secret presence (set/unset) — values are NEVER logged */
function auditSecrets(config: Config): void {
    const secrets: [string, string | undefined][] = [
        ["JIRA_API_TOKEN", config.jiraApiToken],
        ["GITHUB_TOKEN", config.githubToken],
        ["OPENAI_API_KEY", config.openaiApiKey],
        ["ANTHROPIC_API_KEY", config.anthropicApiKey],
        ["GEMINI_API_KEY", config.geminiApiKey],
    ];
    const set = secrets.filter(([, v]) => v).map(([n]) => n);
    const unset = secrets.filter(([, v]) => !v).map(([n]) => n);
    log.info(`Secrets: ${set.join(', ')} ✓${unset.length ? ` | not set: ${unset.join(', ')}` : ''}`);
}

// ─── Helpers ─────────────────────────────────────────────────

/** Build the JQL query for fetching bot-assigned issues */
export function buildBotJql(config: Config): string {
    if (config.jqlOverride) return config.jqlOverride;
    return `assignee = "${config.jiraBotDisplayName}" AND statusCategory != Done AND (labels IS EMPTY OR labels != "ai-failed") ORDER BY created DESC`;
}
