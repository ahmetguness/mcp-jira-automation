"use strict";
/**
 * Zod validation schemas for Jira API responses.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZodJiraSearchResponse = exports.ZodJiraIssue = void 0;
exports.parseJiraIssue = parseJiraIssue;
exports.parseJiraSearchResponse = parseJiraSearchResponse;
var zod_1 = require("zod");
exports.ZodJiraIssue = zod_1.z.object({
    key: zod_1.z.string().optional(),
    issue_key: zod_1.z.string().optional(),
    summary: zod_1.z.string().optional(),
    description: zod_1.z.string().optional().nullable(),
    status: zod_1.z.object({ name: zod_1.z.string().optional() }).optional().nullable(),
    issue_type: zod_1.z.object({ name: zod_1.z.string().optional() }).optional().nullable(),
    issuetype: zod_1.z.object({ name: zod_1.z.string().optional() }).optional().nullable(),
    assignee: zod_1.z.object({
        display_name: zod_1.z.string().optional(),
        name: zod_1.z.string().optional(),
        displayName: zod_1.z.string().optional()
    }).optional().nullable(),
    fields: zod_1.z.object({
        summary: zod_1.z.string().optional(),
        description: zod_1.z.string().optional().nullable(),
        status: zod_1.z.object({ name: zod_1.z.string().optional() }).optional().nullable(),
        issuetype: zod_1.z.object({ name: zod_1.z.string().optional() }).optional().nullable(),
        assignee: zod_1.z.object({
            display_name: zod_1.z.string().optional(),
            name: zod_1.z.string().optional(),
            displayName: zod_1.z.string().optional()
        }).optional().nullable(),
    }).catchall(zod_1.z.unknown()).optional().nullable(),
}).catchall(zod_1.z.unknown());
exports.ZodJiraSearchResponse = zod_1.z.object({
    issues: zod_1.z.array(exports.ZodJiraIssue).optional(),
    result: zod_1.z.object({
        issues: zod_1.z.array(exports.ZodJiraIssue).optional()
    }).optional(),
}).catchall(zod_1.z.unknown());
function parseJiraIssue(input) {
    var result = exports.ZodJiraIssue.safeParse(input);
    if (!result.success) {
        throw new Error("Invalid Jira issue payload: ".concat(result.error.message));
    }
    return result.data;
}
function parseJiraSearchResponse(input) {
    var result = exports.ZodJiraSearchResponse.safeParse(input);
    if (!result.success) {
        throw new Error("Invalid Jira search response payload: ".concat(result.error.message));
    }
    return result.data;
}
