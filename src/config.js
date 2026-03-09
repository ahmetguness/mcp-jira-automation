"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadConfig = loadConfig;
exports.buildBotJql = buildBotJql;
var zod_1 = require("zod");
var logger_js_1 = require("./logger.js");
var log = (0, logger_js_1.createLogger)("config");
// ─── Schema ──────────────────────────────────────────────────
var configSchema = zod_1.z.object({
    // Jira
    jiraBaseUrl: zod_1.z.string().min(1, "JIRA_BASE_URL is required"),
    jiraEmail: zod_1.z.string().min(1, "JIRA_EMAIL is required"),
    jiraApiToken: zod_1.z.string().min(1, "JIRA_API_TOKEN is required"),
    jiraProjectKey: zod_1.z.string().min(1, "JIRA_PROJECT_KEY is required"),
    jiraBotDisplayName: zod_1.z.string().default("AI Cyber Bot"),
    jiraRepoFieldId: zod_1.z.string().optional(),
    jqlOverride: zod_1.z.string().optional(),
    // Listener
    mode: zod_1.z.enum(["poll", "webhook"]).default("poll"),
    pollIntervalMs: zod_1.z.coerce.number().int().min(5000).default(15000),
    webhookPort: zod_1.z.coerce.number().int().default(3000),
    // SCM
    scmProvider: zod_1.z.enum(["github", "gitlab", "bitbucket"]),
    // GitHub
    githubToken: zod_1.z.string().optional(),
    // GitLab
    gitlabToken: zod_1.z.string().optional(),
    gitlabUrl: zod_1.z.string().default("https://gitlab.com"),
    // Bitbucket
    bitbucketUsername: zod_1.z.string().optional(),
    bitbucketAppPassword: zod_1.z.string().optional(),
    bitbucketWorkspace: zod_1.z.string().optional(),
    // AI
    aiProvider: zod_1.z.enum(["openai", "anthropic", "gemini", "vllm"]),
    aiModel: zod_1.z.string().optional(),
    openaiApiKey: zod_1.z.string().optional(),
    anthropicApiKey: zod_1.z.string().optional(),
    geminiApiKey: zod_1.z.string().optional(),
    vllmBaseUrl: zod_1.z.string().optional(),
    vllmModel: zod_1.z.string().optional(),
    // Executor
    execPolicy: zod_1.z.enum(["strict", "permissive"]).default("strict"),
    execTimeoutMs: zod_1.z.coerce.number().int().default(300000), // 5 min
    dockerImage: zod_1.z.string().default("auto"),
    allowInstallScripts: zod_1.z.coerce.boolean().default(false),
    // MCP server paths
    mcpAtlassianUrl: zod_1.z.string().default("http://127.0.0.1:9000/sse"),
    // PR & Branch
    requireApproval: zod_1.z.coerce.boolean().default(false),
    // Logging
    logLevel: zod_1.z.enum(["debug", "info", "warn", "error"]).default("info"),
    // State
    stateFile: zod_1.z.string().default("./data/state.json"),
    maxAttempts: zod_1.z.coerce.number().int().default(3),
});
// ─── Loader ──────────────────────────────────────────────────
function loadConfig() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
    var raw = {
        // Jira
        jiraBaseUrl: (_a = process.env.JIRA_BASE_URL) !== null && _a !== void 0 ? _a : "",
        jiraEmail: (_b = process.env.JIRA_EMAIL) !== null && _b !== void 0 ? _b : "",
        jiraApiToken: (_c = process.env.JIRA_API_TOKEN) !== null && _c !== void 0 ? _c : "",
        jiraProjectKey: (_d = process.env.JIRA_PROJECT_KEY) !== null && _d !== void 0 ? _d : "",
        jiraBotDisplayName: (_e = process.env.JIRA_AI_BOT_DISPLAY_NAME) !== null && _e !== void 0 ? _e : "AI Cyber Bot",
        jiraRepoFieldId: process.env.JIRA_REPO_FIELD_ID || undefined,
        jqlOverride: process.env.JQL_ASSIGNED_TO_BOT || undefined,
        // Listener
        mode: (_f = process.env.MODE) !== null && _f !== void 0 ? _f : "poll",
        pollIntervalMs: (_g = process.env.POLL_INTERVAL_MS) !== null && _g !== void 0 ? _g : "15000",
        webhookPort: (_h = process.env.WEBHOOK_PORT) !== null && _h !== void 0 ? _h : "3000",
        // SCM
        scmProvider: (_j = process.env.SCM_PROVIDER) !== null && _j !== void 0 ? _j : "github",
        githubToken: process.env.GITHUB_TOKEN || undefined,
        gitlabToken: process.env.GITLAB_TOKEN || undefined,
        gitlabUrl: (_k = process.env.GITLAB_URL) !== null && _k !== void 0 ? _k : "https://gitlab.com",
        bitbucketUsername: process.env.BITBUCKET_USERNAME || undefined,
        bitbucketAppPassword: process.env.BITBUCKET_APP_PASSWORD || undefined,
        bitbucketWorkspace: process.env.BITBUCKET_WORKSPACE || undefined,
        // AI
        aiProvider: (_l = process.env.AI_PROVIDER) !== null && _l !== void 0 ? _l : "openai",
        aiModel: process.env.AI_MODEL || undefined,
        openaiApiKey: process.env.OPENAI_API_KEY || undefined,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
        geminiApiKey: process.env.GEMINI_API_KEY || undefined,
        vllmBaseUrl: process.env.VLLM_BASE_URL || undefined,
        vllmModel: process.env.VLLM_MODEL || undefined,
        // Executor
        execPolicy: (_m = process.env.EXEC_POLICY) !== null && _m !== void 0 ? _m : "strict",
        execTimeoutMs: (_o = process.env.EXEC_TIMEOUT_MS) !== null && _o !== void 0 ? _o : "300000",
        dockerImage: (_p = process.env.DOCKER_IMAGE) !== null && _p !== void 0 ? _p : "auto",
        allowInstallScripts: ((_q = process.env.ALLOW_INSTALL_SCRIPTS) !== null && _q !== void 0 ? _q : "false").toLowerCase() === "true",
        // MCP
        mcpAtlassianUrl: (_r = process.env.MCP_SSE_URL) !== null && _r !== void 0 ? _r : "http://127.0.0.1:9000/sse",
        // PR
        requireApproval: ((_s = process.env.REQUIRE_APPROVAL) !== null && _s !== void 0 ? _s : "false").toLowerCase() === "true",
        // Logging
        logLevel: (_t = process.env.LOG_LEVEL) !== null && _t !== void 0 ? _t : "info",
        // State
        stateFile: (_u = process.env.STATE_FILE) !== null && _u !== void 0 ? _u : "./data/state.json",
        maxAttempts: (_v = process.env.MAX_ATTEMPTS) !== null && _v !== void 0 ? _v : "3",
    };
    var result = configSchema.safeParse(raw);
    if (!result.success) {
        var errors = result.error.issues.map(function (i) { return "  - ".concat(i.path.join("."), ": ").concat(i.message); }).join(" ");
        log.error("Config validation failed", { validationErrors: errors });
        throw new Error("Invalid configuration: ".concat(errors));
    }
    auditSecrets(result.data);
    return result.data;
}
/** Log secret presence (set/unset + length) — values are NEVER logged */
function auditSecrets(config) {
    var secrets = [
        ["JIRA_API_TOKEN", config.jiraApiToken],
        ["GITHUB_TOKEN", config.githubToken],
        ["OPENAI_API_KEY", config.openaiApiKey],
        ["ANTHROPIC_API_KEY", config.anthropicApiKey],
        ["GEMINI_API_KEY", config.geminiApiKey],
    ];
    for (var _i = 0, secrets_1 = secrets; _i < secrets_1.length; _i++) {
        var _a = secrets_1[_i], name_1 = _a[0], value = _a[1];
        if (value) {
            log.info("Secret ".concat(name_1, ": SET (len=").concat(value.length, ")"));
        }
        else {
            log.debug("Secret ".concat(name_1, ": NOT SET"));
        }
    }
}
// ─── Helpers ─────────────────────────────────────────────────
/** Build the JQL query for fetching bot-assigned issues */
function buildBotJql(config) {
    if (config.jqlOverride)
        return config.jqlOverride;
    return "assignee = \"".concat(config.jiraBotDisplayName, "\" AND statusCategory != Done AND (labels IS EMPTY OR labels != \"ai-failed\") ORDER BY created DESC");
}
