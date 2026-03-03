import { test, expect } from "vitest";
import { normalizeError } from "../src/logger.js";

test("normalizeError - GitHub 422 PR exists", () => {
    const err = new Error("Validation Failed: {\"message\":\"Validation Failed\",\"errors\":[{\"resource\":\"PullRequest\",\"code\":\"custom\",\"message\":\"A pull request already exists for ahmetguness:ai/kan-5-bunu-yap.\"}],\"documentation_url\":\"https://docs.github.com/rest/pulls/pulls#create-a-pull-request\"}");
    const result = normalizeError(err);

    expect(result.severity).toBe("warn");
    expect(result.message).toBe("PR already exists");
    expect(result.actionHint).toBe("Open existing PR or reuse branch; do not retry PR creation");
    expect(result.prExistsFlag).toBe(true);
    expect(result.data).toEqual({ http: 422, originalMessage: err.message });
});

test("normalizeError - Missing Repository Field", () => {
    const err = new Error("No repository found on issue. Set the Repository custom field.");
    const result = normalizeError(err);

    expect(result.severity).toBe("warn");
    expect(result.message).toBe("Missing Repository field");
    expect(result.actionHint).toBe("Set Repository custom field on Jira issue");
    expect(result.data).toEqual({ originalMessage: err.message });
});

test("normalizeError - MCP disconnected", () => {
    const err = new Error("Connection closed with the server.");
    const result = normalizeError(err);

    expect(result.severity).toBe("error");
    expect(result.message).toBe("MCP disconnected");
    expect(result.actionHint).toBe("Check if the MCP server crashed or network dropped");
    expect(result.data).toEqual({ originalMessage: err.message });
});

test("normalizeError - Generic Error", () => {
    const err = new Error("Something else went wrong");
    const result = normalizeError(err);

    expect(result.severity).toBe("error");
    expect(result.message).toBe("Something else went wrong");
    expect(result.actionHint).toBeUndefined();
    expect(result.prExistsFlag).toBeUndefined();
});
