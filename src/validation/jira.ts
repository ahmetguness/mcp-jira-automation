/**
 * Zod validation schemas for Jira API responses.
 */

import { z } from "zod";

export const ZodJiraIssue = z.object({
    key: z.string().optional(),
    issue_key: z.string().optional(),
    summary: z.string().optional(),
    description: z.string().optional().nullable(),
    status: z.object({ name: z.string().optional() }).optional().nullable(),
    issue_type: z.object({ name: z.string().optional() }).optional().nullable(),
    issuetype: z.object({ name: z.string().optional() }).optional().nullable(),
    assignee: z.object({
        display_name: z.string().optional(),
        name: z.string().optional(),
        displayName: z.string().optional()
    }).optional().nullable(),
    fields: z.object({
        summary: z.string().optional(),
        description: z.string().optional().nullable(),
        status: z.object({ name: z.string().optional() }).optional().nullable(),
        issuetype: z.object({ name: z.string().optional() }).optional().nullable(),
        assignee: z.object({
            display_name: z.string().optional(),
            name: z.string().optional(),
            displayName: z.string().optional()
        }).optional().nullable(),
    }).catchall(z.unknown()).optional().nullable(),
}).catchall(z.unknown());

export const ZodJiraSearchResponse = z.object({
    issues: z.array(ZodJiraIssue).optional(),
    result: z.object({
        issues: z.array(ZodJiraIssue).optional()
    }).optional(),
}).catchall(z.unknown());

export function parseJiraIssue(input: unknown): z.infer<typeof ZodJiraIssue> {
    const result = ZodJiraIssue.safeParse(input);
    if (!result.success) {
        throw new Error(`Invalid Jira issue payload: ${result.error.message}`);
    }
    return result.data;
}

export function parseJiraSearchResponse(input: unknown): z.infer<typeof ZodJiraSearchResponse> {
    const result = ZodJiraSearchResponse.safeParse(input);
    if (!result.success) {
        throw new Error(`Invalid Jira search response payload: ${result.error.message}`);
    }
    return result.data;
}
