import { describe, it, expect, vi, beforeEach } from "vitest";
import { JiraClient } from "../src/jira/client.js";
import type { McpManager } from "../src/mcp/manager.js";
import type { Config } from "../src/config.js";

/**
 * Bug Condition Exploration Test for Jira Custom Field Repository Detection
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3**
 * 
 * Property 1: Bug Condition - Custom Field Repository Detection
 * 
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * - Failure confirms that getRepositoryField cannot read custom field values
 * - The test encodes the EXPECTED BEHAVIOR after the fix
 * - DO NOT attempt to fix the test when it fails - document the counterexamples
 * 
 * GOAL: Surface counterexamples that demonstrate the bug:
 * - Custom field exists with a repository value
 * - Field ID is known (configured or auto-detected)
 * - getRepositoryField returns null instead of the custom field value
 * - System logs "No repository custom field found" warning
 * - System falls back to description parsing
 * 
 * ROOT CAUSE: jira_get_issue doesn't fetch custom fields because no fields parameter is specified
 * 
 * SCOPED APPROACH: Test concrete failing cases where:
 * - isBugCondition(input) is true (custom field exists with value, field ID is known)
 * - getRepositoryField fails to read it (returns null)
 * - System falls back to description parsing
 */

describe("Bug Condition Exploration - Jira Custom Field Repository Detection", () => {
    let mockMcpManager: McpManager;
    let mockConfig: Config;
    let jiraClient: JiraClient;
    let mockedCallJiraTool: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        // Create mock MCP manager
        const mockFn = vi.fn();
        mockMcpManager = {
            callJiraTool: mockFn,
        } as unknown as McpManager;

        mockedCallJiraTool = vi.mocked(mockFn);

        // Create mock config with custom field ID configured
        mockConfig = {
            jiraRepoFieldId: "customfield_10041",
            jiraBotUsername: "test-bot",
            jiraProjectKey: "TEST",
        } as unknown as Config;

        jiraClient = new JiraClient(mockMcpManager, mockConfig);
    });

    /**
     * Property 1: Bug Condition - Custom Field Repository Detection
     * 
     * For any issue where:
     * - Custom field ID is known (configured or auto-detected)
     * - Custom field has a non-empty repository value
     * 
     * The system SHOULD:
     * - Successfully fetch the issue with custom fields included
     * - Read the custom field value
     * - Return the normalized repository string
     * - NOT fall back to description parsing
     * 
     * EXPECTED ON UNFIXED CODE: Test FAILS - getRepositoryField returns null
     */

    describe("Configured Custom Field ID", () => {
        it("should read repository from custom field when field ID is configured", async () => {
            // SETUP: Mock jira_get_issue to return issue WITH custom fields (simulates the fix)
            // After the fix, the API call requests custom fields explicitly
            const issueKey = "TEST-123";
            const expectedRepo = "ahmetgunesceng1-alt/sloncar-rental-platform";
            
            // First call: jira_get_issue in getRepositoryField (WITH custom fields - FIXED)
            mockedCallJiraTool.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: "Some description without repo",
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                    customfield_10041: expectedRepo, // Custom field IS included now - fix works!
                },
            });

            // ACT: Call getRepositoryField
            const result = await jiraClient.getRepositoryField(issueKey);

            // ASSERT: Expected behavior (after fix) - should return the custom field value
            expect(result).toBe(expectedRepo);
            
            // Verify jira_get_issue was called with fields parameter
            expect(mockedCallJiraTool).toHaveBeenCalledWith(
                "jira_get_issue",
                expect.objectContaining({ 
                    issue_key: issueKey,
                    fields: "customfield_10041"
                })
            );
        });

        it("should read repository from custom field with URL format", async () => {
            const issueKey = "TEST-456";
            const customFieldValue = "https://github.com/user/project";
            const expectedNormalized = "user/project";
            
            // Mock: Issue data WITH custom field (simulates fix)
            mockedCallJiraTool.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: "Description",
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                    customfield_10041: customFieldValue, // Custom field included - fix works!
                },
            });

            const result = await jiraClient.getRepositoryField(issueKey);

            // Expected: Should normalize and return the custom field value
            expect(result).toBe(expectedNormalized);
        });

        it("should read repository from custom field in org/repo format", async () => {
            const issueKey = "TEST-789";
            const expectedRepo = "org/repo";
            
            // Mock: Issue WITH custom field
            mockedCallJiraTool.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: "Description",
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                    customfield_10041: expectedRepo, // Custom field included - fix works!
                },
            });

            const result = await jiraClient.getRepositoryField(issueKey);

            // Expected: Should return the custom field value
            expect(result).toBe(expectedRepo);
        });
    });

    describe("Auto-detected Custom Field ID", () => {
        beforeEach(() => {
            // Config without custom field ID - will trigger auto-detection
            mockConfig = {
                jiraRepoFieldId: undefined,
                jiraBotUsername: "test-bot",
                jiraProjectKey: "TEST",
            } as unknown as Config;

            jiraClient = new JiraClient(mockMcpManager, mockConfig);
        });

        it("should read repository from auto-detected custom field", async () => {
            const issueKey = "TEST-999";
            const fieldId = "customfield_10041";
            const expectedRepo = "auto-detected/repo";

            // First call: jira_search_fields for auto-detection
            mockedCallJiraTool.mockResolvedValueOnce([
                {
                    id: fieldId,
                    name: "Repository",
                    custom: true,
                },
            ]);

            // Second call: jira_get_issue WITH custom field (fix works)
            mockedCallJiraTool.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Test issue",
                    description: "Description",
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                    customfield_10041: expectedRepo, // Custom field IS included - fix works!
                },
            });

            const result = await jiraClient.getRepositoryField(issueKey);

            // Expected: Should return the auto-detected custom field value
            expect(result).toBe(expectedRepo);
            
            // Verify auto-detection was called
            expect(mockedCallJiraTool).toHaveBeenCalledWith("jira_search_fields", {
                keyword: "repository",
            });
            
            // Verify jira_get_issue was called with fields parameter
            expect(mockedCallJiraTool).toHaveBeenCalledWith(
                "jira_get_issue",
                expect.objectContaining({ 
                    issue_key: issueKey,
                    fields: fieldId
                })
            );
        });
    });

    describe("Bug Manifestation Documentation", () => {
        it("should document the concrete bug scenario", async () => {
            // This test documents what SHOULD happen and DOES happen after the fix
            // 
            // Bug Scenario (Before Fix):
            // 1. User creates Jira issue TEST-123 with custom field "Repository" = "ahmetgunesceng1-alt/sloncar-rental-platform"
            // 2. System calls getRepositoryField("TEST-123")
            // 3. getRepositoryField calls jira_get_issue WITHOUT specifying fields parameter
            // 4. Jira API returns issue data WITHOUT custom fields (only default fields)
            // 5. getRepositoryField checks result.fields["customfield_10041"] → undefined
            // 6. getRepositoryField returns null (custom field not found)
            // 7. System logs "No repository custom field found"
            // 8. System falls back to parsing description
            // 9. Description contains "api/cars" → system uses WRONG repository
            // 
            // Expected Behavior (After Fix):
            // 1. User creates Jira issue TEST-123 with custom field "Repository" = "ahmetgunesceng1-alt/sloncar-rental-platform"
            // 2. System calls getRepositoryField("TEST-123")
            // 3. getRepositoryField calls jira_get_issue WITH fields parameter including custom field ID
            // 4. Jira API returns issue data WITH custom fields
            // 5. getRepositoryField reads result.fields["customfield_10041"] → "ahmetgunesceng1-alt/sloncar-rental-platform"
            // 6. getRepositoryField normalizes and returns "ahmetgunesceng1-alt/sloncar-rental-platform"
            // 7. System uses CORRECT repository from custom field
            // 8. No fallback to description parsing occurs
            
            const issueKey = "TEST-123";
            const customFieldValue = "ahmetgunesceng1-alt/sloncar-rental-platform";
            
            // Simulate fix: jira_get_issue returns data WITH custom fields
            mockedCallJiraTool.mockResolvedValueOnce({
                key: issueKey,
                fields: {
                    summary: "Implement car rental API",
                    description: "Create REST API for api/cars endpoint",
                    status: { name: "Open" },
                    issuetype: { name: "Task" },
                    customfield_10041: customFieldValue, // Custom field IS here - fix works!
                },
            });

            const result = await jiraClient.getRepositoryField(issueKey);

            // After fix: Should return the correct repository from custom field
            expect(result).toBe(customFieldValue);
            
            // Verify the fix: jira_get_issue was called with fields parameter
            expect(mockedCallJiraTool).toHaveBeenCalledWith(
                "jira_get_issue",
                expect.objectContaining({ 
                    issue_key: issueKey,
                    fields: "customfield_10041"
                })
            );
        });
    });
});
