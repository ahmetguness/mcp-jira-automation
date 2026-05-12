import { describe, it, expect, afterEach, vi } from "vitest";
import { buildBotJql } from "../src/config.js";
import type { Config } from "../src/config.js";

describe("Config Utilities", () => {
    // ── buildBotJql ──────────────────────────────────────

    describe("buildBotJql", () => {
        it("should scope JQL override to the configured bot assignee", () => {
            const config = {
                jiraBotDisplayName: "AI Cyber Bot",
                jiraAssigneeJql: "ahmetgunes.ceng@gmail.com",
                jqlOverride: 'project = KAN AND "Repository" is not EMPTY ORDER BY created DESC',
            } as Config;

            const jql = buildBotJql(config);
            expect(jql).toBe('assignee = "ahmetgunes.ceng@gmail.com" AND (project = KAN AND "Repository" is not EMPTY) ORDER BY created DESC');
        });

        it("should build default JQL with bot display name", () => {
            const config = {
                jiraBotDisplayName: "AI Cyber Bot",
                jiraAssigneeJql: "bot@test.com",
                jqlOverride: undefined,
            } as Config;

            const jql = buildBotJql(config);
            expect(jql).toContain('assignee = "bot@test.com"');
            expect(jql).toContain("statusCategory != Done");
            expect(jql).toContain("ai-failed");
            expect(jql).toContain("ORDER BY created DESC");
        });

        it("should allow an explicit assignee JQL value", () => {
            const config = {
                jiraAssigneeJql: "My Custom Bot",
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

        it("should load requireApproval as true when REQUIRE_APPROVAL is 'true'", async () => {
            process.env.JIRA_BASE_URL = "https://test.atlassian.net";
            process.env.JIRA_EMAIL = "bot@test.com";
            process.env.JIRA_API_TOKEN = "test-token";
            process.env.JIRA_PROJECT_KEY = "TEST";
            process.env.SCM_PROVIDER = "github";
            process.env.AI_PROVIDER = "openai";
            process.env.MODE = "poll";
            process.env.REQUIRE_APPROVAL = "true";

            const { loadConfig } = await import("../src/config.js");
            const config = loadConfig();

            expect(config.requireApproval).toBe(true);
        });

        it("should load requireApproval as false when REQUIRE_APPROVAL is 'false'", async () => {
            process.env.JIRA_BASE_URL = "https://test.atlassian.net";
            process.env.JIRA_EMAIL = "bot@test.com";
            process.env.JIRA_API_TOKEN = "test-token";
            process.env.JIRA_PROJECT_KEY = "TEST";
            process.env.SCM_PROVIDER = "github";
            process.env.AI_PROVIDER = "openai";
            process.env.MODE = "poll";
            process.env.REQUIRE_APPROVAL = "false";

            const { loadConfig } = await import("../src/config.js");
            const config = loadConfig();

            expect(config.requireApproval).toBe(false);
        });

        it("should default requireApproval to false when REQUIRE_APPROVAL is not set", async () => {
            process.env.JIRA_BASE_URL = "https://test.atlassian.net";
            process.env.JIRA_EMAIL = "bot@test.com";
            process.env.JIRA_API_TOKEN = "test-token";
            process.env.JIRA_PROJECT_KEY = "TEST";
            process.env.SCM_PROVIDER = "github";
            process.env.AI_PROVIDER = "openai";
            process.env.MODE = "poll";
            delete process.env.REQUIRE_APPROVAL;

            const { loadConfig } = await import("../src/config.js");
            const config = loadConfig();

            expect(config.requireApproval).toBe(false);
        });

        it("should handle case-insensitive REQUIRE_APPROVAL values", async () => {
            process.env.JIRA_BASE_URL = "https://test.atlassian.net";
            process.env.JIRA_EMAIL = "bot@test.com";
            process.env.JIRA_API_TOKEN = "test-token";
            process.env.JIRA_PROJECT_KEY = "TEST";
            process.env.SCM_PROVIDER = "github";
            process.env.AI_PROVIDER = "openai";
            process.env.MODE = "poll";
            process.env.REQUIRE_APPROVAL = "TRUE";

            const { loadConfig } = await import("../src/config.js");
            const config = loadConfig();

            expect(config.requireApproval).toBe(true);
        });
    });
});
