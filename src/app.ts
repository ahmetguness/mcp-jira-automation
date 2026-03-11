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
import { createLogger } from "./logger.js";
import { Executor } from "./executor/index.js";
import { ApiTestOrchestrator } from "./api-testing/orchestrator/ApiTestOrchestrator.js";

const log = createLogger("app");

export class App {
    private mcp: McpManager;
    private jira!: JiraClient;
    private scm!: ScmProvider;
    private ai!: AiProvider;
    private pipeline!: PipelineHandler;
    private apiTestOrchestrator!: ApiTestOrchestrator;
    private executor!: Executor;
    private state: StateStore;
    private poller: JiraPoller | null = null;
    private webhook: JiraWebhook | null = null;

    constructor(private config: Config) {
        this.mcp = new McpManager(config);
        this.state = new StateStore(config.stateFile);
    }

    /** Initialize all components */
    async start(): Promise<void> {

        // 1. Connect MCP servers
        log.info("Connecting to MCP servers...");
        await this.mcp.connect();

        // 2. Create services
        this.jira = new JiraClient(this.mcp, this.config);
        this.scm = createScmProvider(this.config, this.mcp);
        this.ai = createAiProvider(this.config);
        this.executor = new Executor(this.config);
        this.pipeline = new PipelineHandler(this.config, this.jira, this.scm, this.ai, this.state);
        
        this.apiTestOrchestrator = new ApiTestOrchestrator({
            appConfig: this.config,
            jira: {
                jiraBaseUrl: this.config.jiraBaseUrl,
                jiraEmail: this.config.jiraEmail,
                jiraApiToken: this.config.jiraApiToken,
                botUserIdentifier: this.config.jiraBotDisplayName,
            },
            repository: {
                // If possible, these would be loaded from env or config. Using defaults for now.
                defaultBranch: "main",
                scmAuthToken: this.config.githubToken || this.config.gitlabToken || this.config.bitbucketAppPassword,
            },
            execution: {
                timeoutSeconds: this.config.execTimeoutMs / 1000,
            },
            requireApproval: this.config.requireApproval,
        });

        // 3. Check Docker
        const dockerReady = await this.executor.isReady();
        if (!dockerReady) {
            log.warn("⚠️ Docker is not available. Execution will fail. Please start Docker.");
        }

        // 4. Start listener
        const handleIssue = async (issue: any) => {
            // Determine if issue is an API test task. For now, check for a specific label or summary keyword
            const isApiTest = issue.fields?.labels?.includes("api-test") || 
                              issue.summary?.toLowerCase().includes("api test");
            
            if (isApiTest) {
                log.info(`Routing issue ${issue.key} to ApiTestOrchestrator`);
                await this.apiTestOrchestrator.processTaskByKey(issue.key);
            } else {
                log.info(`Routing issue ${issue.key} to PipelineHandler`);
                await this.pipeline.handle(issue);
            }
        };

        if (this.config.mode === "webhook") {
            this.webhook = new JiraWebhook(this.jira, this.config);
            this.webhook.start(handleIssue);
        } else {
            this.poller = new JiraPoller(this.jira, this.config);
            this.poller.start(handleIssue);
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
            try {
                await this.stop();
                process.exit(0);
            } catch (e) {
                log.error(`Application crashed during shutdown: ${String(e)}`);
                process.exit(1);
            }
        };

        process.on("SIGINT", () => void shutdown());
        process.on("SIGTERM", () => void shutdown());

        process.on("uncaughtException", (err) => {
            log.error(`Uncaught exception: ${err.message}`);
            log.error(err.stack ?? "");
            void shutdown();
        });

        process.on("unhandledRejection", (reason) => {
            log.error(`Unhandled rejection: ${String(reason)}`);
        });
    }
}
