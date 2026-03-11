/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/require-await */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { JiraClient, normalizeRepoUrl } from "../src/jira/client.js";
import type { McpManager } from "../src/mcp/manager.js";
import type { Config } from "../src/config.js";

/**
 * Preservation Property Tests for Jira Custom Field Repository Detection
 * 
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 * 
 * Property 2: Preservation - Fallback Behavior
 * 
 * IMPORTANT: These tests run on UNFIXED code to establish baseline behavior
 * - Tests should PASS on unfixed code
 * - Tests verify that fallback behavior works correctly when custom fields are not present/empty
 * - After the fix, these tests should still PASS (no regressions)
 * 
 * GOAL: Verify that for all inputs where the bug condition does NOT hold:
 * - Issues without repository custom field configured fall back to description parsing
 * - Issues with empty/null custom field values fall back to description parsing
 * - Description parsing correctly normalizes repository URLs
 * - Custom field auto-detection caching works correctly
 * 
 * PRESERVATION SCOPE:
 * All inputs that do NOT involve reading a populated custom field should be unaffected:
 * - Issues without a repository custom field configured
 * - Issues with empty/null custom field values
 * - The description parsing fallback logic
 * - The normalizeRepoUrl function behavior
 * - The detectRepositoryFieldId caching behavior
 */

describe("Preservation Property Tests - Jira Custom Field Fallback Behavior", () => {
    let mockMcpManager: McpManager;
    let mockConfig: Config;
    let jiraClient: JiraClient;

    beforeEach(() => {
        // Create mock MCP manager
        mockMcpManager = {
            callJiraTool: vi.fn(),
        } as unknown as McpManager;

        // Create mock config without custom field ID (will trigger fallback)
        mockConfig = {
            jiraRepoFieldId: undefined,
            jiraBotUsername: "test-bot",
            jiraProjectKey: "TEST",
        } as unknown as Config;

        jiraClient = new JiraClient(mockMcpManager, mockConfig);
    });

    /**
     * Property 2.1: No Custom Field Configured - Falls Back to Description Parsing
     * 
     * For any issue where no custom field is configured:
     * - System should attempt auto-detection
     * - If auto-detection fails, system should fall back to parsing description
     * - Description parsing should work correctly
     * - Repository URL should be normalized
     */
    describe("No Custom Field Configured", () => {
        it("should fall back to description parsing when no custom field exists", async () => {
            const issueKey = "TEST-100";
            const repoInDescription = "myorg/myrepo";
            
            // Store the function reference to avoid `this` binding issues
            const callJiraToolFn = mockMcpManager.callJiraTool;
            const mockFn = vi.mocked(callJiraToolFn);
            
            // Mock: jira_get_fields returns no repository field (auto-detection fails)
            mockFn.mockResolvedValueOnce([
                { id: "customfield_10001", name: "Sprint", custom: true },
                { id: "customfield_10002", name: "Story Points", custom: true },
            ]);

            // Mock: getIssue call for fallback
            mockFn.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: `Repository: ${repoInDescription}`,
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                },
            });

            const result = await jiraClient.getRepositoryField(issueKey);

            // Should successfully parse from description
            expect(result).toBe(repoInDescription);
        });

        it("should parse repository from GitHub URL in description", async () => {
            const issueKey = "TEST-101";
            const githubUrl = "https://github.com/user/project";
            const expectedNormalized = "user/project";
            
            // Create fresh client for this test
            const freshMockMcp = {
                callJiraTool: vi.fn(),
            } as unknown as McpManager;
            
            const freshClient = new JiraClient(freshMockMcp, mockConfig);
            
            // Store the function reference to avoid `this` binding issues
            const callJiraToolFn = freshMockMcp.callJiraTool;
            const mockFn = vi.mocked(callJiraToolFn);
            
            // Mock implementation that returns different values based on call count
            let callCount = 0;
            mockFn.mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    // First call: jira_search_fields returns empty
                    return [];
                } else {
                    // Second call: jira_get_issue returns issue data
                    return {
                        key: issueKey,
                        summary: "Test issue",
                        description: `Check out the code at ${githubUrl}`,
                        status: { name: "Open" },
                        issue_type: { name: "Task" },
                    };
                }
            });

            const result = await freshClient.getRepositoryField(issueKey);

            // Should normalize GitHub URL to org/repo format
            expect(result).toBe(expectedNormalized);
        });
    });

    /**
     * Property 2.2: Empty/Null Custom Field - Falls Back to Description Parsing
     * 
     * For any issue where custom field exists but is empty or null:
     * - System should detect the custom field
     * - System should find empty/null value
     * - System should fall back to parsing description
     * - Description parsing should work correctly
     */
    describe("Empty or Null Custom Field Values", () => {
        beforeEach(() => {
            // Config with custom field ID configured
            mockConfig = {
                jiraRepoFieldId: "customfield_10041",
                jiraBotUsername: "test-bot",
                jiraProjectKey: "TEST",
            } as unknown as Config;

            jiraClient = new JiraClient(mockMcpManager, mockConfig);
        });

        it("should fall back to description when custom field is empty string", async () => {
            const issueKey = "TEST-200";
            const repoInDescription = "fallback/repo";
            
            const callJiraToolFn = mockMcpManager.callJiraTool;
            const mockFn = vi.mocked(callJiraToolFn);
            
            // Mock: jira_get_issue returns issue with empty custom field
            mockFn.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: `Repository: ${repoInDescription}`,
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                    customfield_10041: "", // Empty custom field
                },
            });

            // Mock: getIssue fallback call
            mockFn.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: `Repository: ${repoInDescription}`,
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                },
            });

            const result = await jiraClient.getRepositoryField(issueKey);

            // Should fall back to description parsing
            expect(result).toBe(repoInDescription);
        });

        it("should fall back to description when custom field is null", async () => {
            const issueKey = "TEST-201";
            const repoInDescription = "another/repo";
            
            const callJiraToolFn = mockMcpManager.callJiraTool;
            const mockFn = vi.mocked(callJiraToolFn);
            
            // Mock: jira_get_issue returns issue with null custom field
            mockFn.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: `Repo: ${repoInDescription}`,
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                    customfield_10041: null, // Null custom field
                },
            });

            // Mock: getIssue fallback call
            mockFn.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: `Repo: ${repoInDescription}`,
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                },
            });

            const result = await jiraClient.getRepositoryField(issueKey);

            // Should fall back to description parsing
            expect(result).toBe(repoInDescription);
        });

        it("should fall back to description when custom field is undefined", async () => {
            const issueKey = "TEST-202";
            const repoInDescription = "undefined/test";
            
            const callJiraToolFn = mockMcpManager.callJiraTool;
            const mockFn = vi.mocked(callJiraToolFn);
            
            // Mock: jira_get_issue returns issue without custom field property
            mockFn.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: `Repository: ${repoInDescription}`,
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                    // customfield_10041 not present at all
                },
            });

            // Mock: getIssue fallback call
            mockFn.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: `Repository: ${repoInDescription}`,
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                },
            });

            const result = await jiraClient.getRepositoryField(issueKey);

            // Should fall back to description parsing
            expect(result).toBe(repoInDescription);
        });
    });

    /**
     * Property 2.3: Description Parsing Correctly Normalizes Repository URLs
     * 
     * Property-based test: For any repository URL format in description,
     * the system should correctly parse and normalize it to org/repo format
     */
    describe("Description Parsing and Normalization", () => {
        beforeEach(() => {
            // No custom field configured - will use description parsing
            mockConfig = {
                jiraRepoFieldId: undefined,
                jiraBotUsername: "test-bot",
                jiraProjectKey: "TEST",
            } as unknown as Config;

            jiraClient = new JiraClient(mockMcpManager, mockConfig);
        });

        it("should normalize org/repo format correctly", async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.tuple(
                        fc.stringMatching(/^[a-z0-9-]+$/),
                        fc.stringMatching(/^[a-z0-9-]+$/)
                    ),
                    async ([org, repo]) => {
                        // Create fresh mocks for each property test run
                        const freshMockMcp = {
                            callJiraTool: vi.fn(),
                        } as unknown as McpManager;
                        
                        const freshClient = new JiraClient(freshMockMcp, mockConfig);
                        
                        const issueKey = "TEST-300";
                        const repoString = `${org}/${repo}`;
                        
                        // Store the function reference to avoid `this` binding issues
                        const callJiraToolFn = freshMockMcp.callJiraTool;
                        const mockFn = vi.mocked(callJiraToolFn);
                        
                        // Mock implementation
                        let callCount = 0;
                        mockFn.mockImplementation(async () => {
                            callCount++;
                            if (callCount === 1) {
                                return []; // jira_search_fields returns empty
                            } else {
                                return {
                                    key: issueKey,
                                    summary: "Test issue",
                                    description: `Repository: ${repoString}`,
                                    status: { name: "Open" },
                                    issue_type: { name: "Task" },
                                };
                            }
                        });

                        const result = await freshClient.getRepositoryField(issueKey);

                        // Should return the org/repo format as-is
                        expect(result).toBe(repoString);
                    }
                ),
                { numRuns: 10 } // Limit runs for faster execution
            );
        });

        it("should normalize GitHub URLs correctly", async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.tuple(
                        fc.stringMatching(/^[a-z0-9-]+$/),
                        fc.stringMatching(/^[a-z0-9-]+$/)
                    ),
                    async ([org, repo]) => {
                        // Create fresh mocks for each property test run
                        const freshMockMcp = {
                            callJiraTool: vi.fn(),
                        } as unknown as McpManager;
                        
                        const freshClient = new JiraClient(freshMockMcp, mockConfig);
                        
                        const issueKey = "TEST-301";
                        const githubUrl = `https://github.com/${org}/${repo}`;
                        const expectedNormalized = `${org}/${repo}`;
                        
                        // Store the function reference to avoid `this` binding issues
                        const callJiraToolFn = freshMockMcp.callJiraTool;
                        const mockFn = vi.mocked(callJiraToolFn);
                        
                        // Mock implementation
                        let callCount = 0;
                        mockFn.mockImplementation(async () => {
                            callCount++;
                            if (callCount === 1) {
                                return []; // jira_search_fields returns empty
                            } else {
                                return {
                                    key: issueKey,
                                    summary: "Test issue",
                                    description: `Check ${githubUrl} for details`,
                                    status: { name: "Open" },
                                    issue_type: { name: "Task" },
                                };
                            }
                        });

                        const result = await freshClient.getRepositoryField(issueKey);

                        // Should normalize to org/repo format
                        expect(result).toBe(expectedNormalized);
                    }
                ),
                { numRuns: 10 }
            );
        });

        it("should normalize GitLab URLs correctly", async () => {
            await fc.assert(
                fc.asyncProperty(
                    fc.tuple(
                        fc.stringMatching(/^[a-z0-9-]+$/),
                        fc.stringMatching(/^[a-z0-9-]+$/)
                    ),
                    async ([org, repo]) => {
                        // Create fresh mocks for each property test run
                        const freshMockMcp = {
                            callJiraTool: vi.fn(),
                        } as unknown as McpManager;
                        
                        const freshClient = new JiraClient(freshMockMcp, mockConfig);
                        
                        const issueKey = "TEST-302";
                        const gitlabUrl = `https://gitlab.com/${org}/${repo}`;
                        const expectedNormalized = `${org}/${repo}`;
                        
                        // Store the function reference to avoid `this` binding issues
                        const callJiraToolFn = freshMockMcp.callJiraTool;
                        const mockFn = vi.mocked(callJiraToolFn);
                        
                        // Mock implementation
                        let callCount = 0;
                        mockFn.mockImplementation(async () => {
                            callCount++;
                            if (callCount === 1) {
                                return []; // jira_search_fields returns empty
                            } else {
                                return {
                                    key: issueKey,
                                    summary: "Test issue",
                                    description: `Repository: ${gitlabUrl}`,
                                    status: { name: "Open" },
                                    issue_type: { name: "Task" },
                                };
                            }
                        });

                        const result = await freshClient.getRepositoryField(issueKey);

                        // Should normalize to org/repo format
                        expect(result).toBe(expectedNormalized);
                    }
                ),
                { numRuns: 10 }
            );
        });
    });

    /**
     * Property 2.4: Custom Field Auto-Detection Caching
     * 
     * The auto-detection mechanism should cache the field ID to avoid repeated API calls
     */
    describe("Auto-Detection Caching", () => {
        beforeEach(() => {
            // No custom field configured - will trigger auto-detection
            mockConfig = {
                jiraRepoFieldId: undefined,
                jiraBotUsername: "test-bot",
                jiraProjectKey: "TEST",
            } as unknown as Config;

            jiraClient = new JiraClient(mockMcpManager, mockConfig);
        });

        it("should cache auto-detected field ID and not call jira_search_fields again", async () => {
            const fieldId = "customfield_10041";
            
            const callJiraToolFn = mockMcpManager.callJiraTool;
            const mockFn = vi.mocked(callJiraToolFn);
            
            // First call: auto-detection (jira_search_fields)
            mockFn.mockResolvedValueOnce([
                { id: fieldId, name: "Repository", custom: true },
            ]);

            // First issue fetch (no custom field in response - will fall back)
            mockFn.mockResolvedValueOnce({
                key: "TEST-400",
                fields: {
                    summary: "Test issue 1",
                    description: "Repository: first/repo",
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                },
            });

            // Fallback getIssue call (flat structure)
            mockFn.mockResolvedValueOnce({
                key: "TEST-400",
                summary: "Test issue 1",
                description: "Repository: first/repo",
                status: { name: "Open" },
                issue_type: { name: "Task" },
            });

            await jiraClient.getRepositoryField("TEST-400");

            // Second issue fetch (should NOT call jira_search_fields again)
            mockFn.mockResolvedValueOnce({
                key: "TEST-401",
                fields: {
                    summary: "Test issue 2",
                    description: "Repository: second/repo",
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                },
            });

            // Fallback getIssue call (flat structure)
            mockFn.mockResolvedValueOnce({
                key: "TEST-401",
                summary: "Test issue 2",
                description: "Repository: second/repo",
                status: { name: "Open" },
                issue_type: { name: "Task" },
            });

            await jiraClient.getRepositoryField("TEST-401");

            // Verify jira_search_fields was called only once (caching works)
            const searchFieldsCalls = mockFn.mock.calls
                .filter(call => call[0] === "jira_search_fields");
            
            expect(searchFieldsCalls).toHaveLength(1);
        });
    });

    /**
     * Property 2.5: normalizeRepoUrl Function Behavior
     * 
     * The normalizeRepoUrl function should consistently normalize various URL formats
     * This function is used for both custom field values and description parsing
     */
    describe("normalizeRepoUrl Function", () => {
        it("should preserve org/repo format", () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        fc.stringMatching(/^[a-z0-9-]+$/),
                        fc.stringMatching(/^[a-z0-9-]+$/)
                    ),
                    ([org, repo]) => {
                        const input = `${org}/${repo}`;
                        const result = normalizeRepoUrl(input);
                        expect(result).toBe(input);
                    }
                ),
                { numRuns: 20 }
            );
        });

        it("should extract org/repo from GitHub URLs", () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        fc.stringMatching(/^[a-z0-9-]+$/),
                        fc.stringMatching(/^[a-z0-9-]+$/)
                    ),
                    ([org, repo]) => {
                        const input = `https://github.com/${org}/${repo}`;
                        const expected = `${org}/${repo}`;
                        const result = normalizeRepoUrl(input);
                        expect(result).toBe(expected);
                    }
                ),
                { numRuns: 20 }
            );
        });

        it("should extract org/repo from GitLab URLs", () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        fc.stringMatching(/^[a-z0-9-]+$/),
                        fc.stringMatching(/^[a-z0-9-]+$/)
                    ),
                    ([org, repo]) => {
                        const input = `https://gitlab.com/${org}/${repo}`;
                        const expected = `${org}/${repo}`;
                        const result = normalizeRepoUrl(input);
                        expect(result).toBe(expected);
                    }
                ),
                { numRuns: 20 }
            );
        });

        it("should handle URLs with .git suffix", () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        fc.stringMatching(/^[a-z0-9-]+$/),
                        fc.stringMatching(/^[a-z0-9-]+$/)
                    ),
                    ([org, repo]) => {
                        const input = `https://github.com/${org}/${repo}.git`;
                        const expected = `${org}/${repo}`;
                        const result = normalizeRepoUrl(input);
                        expect(result).toBe(expected);
                    }
                ),
                { numRuns: 20 }
            );
        });

        it("should handle URLs with trailing slash", () => {
            fc.assert(
                fc.property(
                    fc.tuple(
                        fc.stringMatching(/^[a-z0-9-]+$/),
                        fc.stringMatching(/^[a-z0-9-]+$/)
                    ),
                    ([org, repo]) => {
                        const input = `https://github.com/${org}/${repo}/`;
                        const expected = `${org}/${repo}`;
                        const result = normalizeRepoUrl(input);
                        expect(result).toBe(expected);
                    }
                ),
                { numRuns: 20 }
            );
        });

        it("should handle whitespace trimming", () => {
            const input = "  org/repo  ";
            const expected = "org/repo";
            const result = normalizeRepoUrl(input);
            expect(result).toBe(expected);
        });
    });
});
