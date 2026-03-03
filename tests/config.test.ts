import { describe, it, expect, afterEach, vi } from "vitest";
import { buildBotJql } from "../src/config.js";
import type { Config } from "../src/config.js";

describe("Config Utilities", () => {
    // ── buildBotJql ──────────────────────────────────────

    describe("buildBotJql", () => {
        it("should return JQL override if provided", () => {
            const config = {
                jqlOverride: "assignee = 'custom' ORDER BY created",
            } as Config;

            const jql = buildBotJql(config);
            expect(jql).toBe("assignee = 'custom' ORDER BY created");
        });

        it("should build default JQL with bot display name", () => {
            const config = {
                jiraBotDisplayName: "AI Cyber Bot",
                jqlOverride: undefined,
            } as Config;

            const jql = buildBotJql(config);
            expect(jql).toContain('assignee = "AI Cyber Bot"');
            expect(jql).toContain("statusCategory != Done");
            expect(jql).toContain("ai-failed");
            expect(jql).toContain("ORDER BY created DESC");
        });

        it("should use custom bot display name in default JQL", () => {
            const config = {
                jiraBotDisplayName: "My Custom Bot",
                jqlOverride: undefined,
            } as Config;

            const jql = buildBotJql(config);
            expect(jql).toContain('assignee = "My Custom Bot"');
        });
    });

    // ── loadConfig ───────────────────────────────────────

    describe("loadConfig", () => {
        const originalEnv = { ...process.env };

        afterEach(() => {
            // Restore original env
            process.env = { ...originalEnv };
            vi.resetModules();
        });

        it("should throw on missing required fields", async () => {
            // Clear all related env vars
            delete process.env.JIRA_BASE_URL;
            delete process.env.JIRA_EMAIL;
            delete process.env.JIRA_API_TOKEN;
            delete process.env.JIRA_PROJECT_KEY;
            delete process.env.SCM_PROVIDER;
            delete process.env.AI_PROVIDER;

            process.env.JIRA_BASE_URL = "";
            process.env.JIRA_EMAIL = "";
            process.env.JIRA_API_TOKEN = "";
            process.env.JIRA_PROJECT_KEY = "";

            const { loadConfig } = await import("../src/config.js");

            expect(() => loadConfig()).toThrow("Invalid configuration");
        });

        it("should load valid config from env vars", async () => {
            process.env.JIRA_BASE_URL = "https://test.atlassian.net";
            process.env.JIRA_EMAIL = "bot@test.com";
            process.env.JIRA_API_TOKEN = "test-token";
            process.env.JIRA_PROJECT_KEY = "TEST";
            process.env.SCM_PROVIDER = "github";
            process.env.AI_PROVIDER = "openai";
            process.env.EXEC_POLICY = "strict";
            process.env.LOG_LEVEL = "info";
            process.env.MODE = "poll";

            const { loadConfig } = await import("../src/config.js");
            const config = loadConfig();

            expect(config.jiraBaseUrl).toBe("https://test.atlassian.net");
            expect(config.jiraEmail).toBe("bot@test.com");
            expect(config.scmProvider).toBe("github");
            expect(config.aiProvider).toBe("openai");
            expect(config.execPolicy).toBe("strict");
        });

        it("should apply defaults for optional fields", async () => {
            process.env.JIRA_BASE_URL = "https://test.atlassian.net";
            process.env.JIRA_EMAIL = "bot@test.com";
            process.env.JIRA_API_TOKEN = "test-token";
            process.env.JIRA_PROJECT_KEY = "TEST";
            process.env.SCM_PROVIDER = "github";
            process.env.AI_PROVIDER = "openai";
            process.env.MODE = "poll";

            const { loadConfig } = await import("../src/config.js");
            const config = loadConfig();

            expect(config.mode).toBe("poll");
            expect(config.pollIntervalMs).toBe(15000);
            expect(config.execPolicy).toBe("strict");
            expect(config.requireApproval).toBe(false);
            expect(config.maxAttempts).toBe(3);
        });
    });
});
