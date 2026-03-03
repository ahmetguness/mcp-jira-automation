/**
 * App orchestrator — wires everything together and manages the application lifecycle.
 */

import type { Config } from "./config.js";
import { McpManager } from "./mcp/manager.js";
import { JiraClient, JiraPoller, JiraWebhook } from "./jira/index.js";
import { createScmProvider, type ScmProvider } from "./scm/index.js";
import { createAiProvider, type AiProvider } from "./ai/index.js";
import { PipelineHandler } from "./pipeline/handler.js";
import { StateStore } from "./state/store.js";
import { createLogger, setLogLevel } from "./logger.js";

const log = createLogger("app");

export class App {
    private mcp: McpManager;
    private jira!: JiraClient;
    private scm!: ScmProvider;
    private ai!: AiProvider;
    private pipeline!: PipelineHandler;
    private state: StateStore;
    private poller: JiraPoller | null = null;
    private webhook: JiraWebhook | null = null;

    constructor(private config: Config) {
        setLogLevel(config.logLevel);
        this.mcp = new McpManager(config);
        this.state = new StateStore(config.stateFile);
    }

    /** Initialize all components */
    async start(): Promise<void> {
        log.info("═══════════════════════════════════════════");
        log.info("  MCP Jira Automation — AI Cyber Bot");
        log.info("═══════════════════════════════════════════");
        log.info(`SCM Provider: ${this.config.scmProvider}`);
        log.info(`AI Provider:  ${this.config.aiProvider}`);
        log.info(`Mode:         ${this.config.mode}`);
        log.info(`Policy:       ${this.config.execPolicy}`);
        log.info(`Approval:     ${this.config.requireApproval}`);
        log.info("═══════════════════════════════════════════");

        // 1. Connect MCP servers
        log.info("Connecting to MCP servers...");
        await this.mcp.connect();

        // 2. Create services
        this.jira = new JiraClient(this.mcp, this.config);
        this.scm = createScmProvider(this.config, this.mcp);
        this.ai = createAiProvider(this.config);
        this.pipeline = new PipelineHandler(this.config, this.jira, this.scm, this.ai, this.state);

        // 3. Check Docker
        const dockerReady = await this.pipeline.isReady();
        if (!dockerReady) {
            log.warn("⚠️ Docker is not available. Execution will fail. Please start Docker.");
        }

        // 4. Start listener
        if (this.config.mode === "webhook") {
            this.webhook = new JiraWebhook(this.jira, this.config);
            this.webhook.start(async (issue) => { await this.pipeline.handle(issue); });
        } else {
            this.poller = new JiraPoller(this.jira, this.config);
            this.poller.start(async (issue) => { await this.pipeline.handle(issue); });
        }

        log.info("🚀 AI Cyber Bot is running!");

        // 5. Graceful shutdown
        this.setupShutdownHandlers();
    }

    /** Gracefully stop all components */
    async stop(): Promise<void> {
        log.info("Shutting down...");

        if (this.poller) this.poller.stop();
        if (this.webhook) this.webhook.stop();

        await this.mcp.close();

        log.info("Goodbye! 👋");
    }

    private setupShutdownHandlers(): void {
        const shutdown = async () => {
            await this.stop();
            process.exit(0);
        };

        process.on("SIGINT", () => void shutdown());
        process.on("SIGTERM", () => void shutdown());

        process.on("uncaughtException", (err) => {
            log.error(`Uncaught exception: ${err.message}`);
            log.error(err.stack ?? "");
            void shutdown();
        });

        process.on("unhandledRejection", (reason) => {
            log.error(`Unhandled rejection: ${reason}`);
        });
    }
}
