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
    aiProvider: z.enum(["openai", "anthropic", "gemini", "vllm"]),
    aiModel: z.string().optional(),
    openaiApiKey: z.string().optional(),
    anthropicApiKey: z.string().optional(),
    geminiApiKey: z.string().optional(),
    vllmBaseUrl: z.string().optional(),
    vllmModel: z.string().optional(),

    // Executor
    execPolicy: z.enum(["strict", "permissive"]).default("strict"),
    execTimeoutMs: z.coerce.number().int().default(300_000), // 5 min
    dockerImage: z.string().default("auto"),
    allowInstallScripts: z.coerce.boolean().default(false),

    // MCP server paths
    mcpAtlassianUrl: z.string().default("http://127.0.0.1:9000/sse"),

    // PR & Branch
    requireApproval: z.coerce.boolean().default(false),

    // Logging
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),

    // State
    stateFile: z.string().default("./data/state.json"),
    maxAttempts: z.coerce.number().int().default(3),
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

        // Executor
        execPolicy: process.env.EXEC_POLICY ?? "strict",
        execTimeoutMs: process.env.EXEC_TIMEOUT_MS ?? "300000",
        dockerImage: process.env.DOCKER_IMAGE ?? "auto",
        allowInstallScripts: (process.env.ALLOW_INSTALL_SCRIPTS ?? "false").toLowerCase() === "true",

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
    return result.data;
}

/** Log secret presence (set/unset + length) — values are NEVER logged */
function auditSecrets(config: Config): void {
    const secrets: [string, string | undefined][] = [
        ["JIRA_API_TOKEN", config.jiraApiToken],
        ["GITHUB_TOKEN", config.githubToken],
        ["OPENAI_API_KEY", config.openaiApiKey],
        ["ANTHROPIC_API_KEY", config.anthropicApiKey],
        ["GEMINI_API_KEY", config.geminiApiKey],
    ];
    for (const [name, value] of secrets) {
        if (value) {
            log.info(`Secret ${name}: SET (len=${value.length})`);
        } else {
            log.debug(`Secret ${name}: NOT SET`);
        }
    }
}

// ─── Helpers ─────────────────────────────────────────────────

/** Build the JQL query for fetching bot-assigned issues */
export function buildBotJql(config: Config): string {
    if (config.jqlOverride) return config.jqlOverride;
    return `assignee = "${config.jiraBotDisplayName}" AND statusCategory != Done AND (labels IS EMPTY OR labels != "ai-failed") ORDER BY created DESC`;
}
