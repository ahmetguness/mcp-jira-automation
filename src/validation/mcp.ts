/**
 * Zod validation schemas for MCP tool responses.
 */

import { z } from "zod";

export const ZodMcpToolResult = z.object({
    structuredContent: z.object({
        result: z.unknown()
    }).catchall(z.unknown()).optional(),
    content: z.array(
        z.object({
            text: z.string().optional()
        }).catchall(z.unknown())
    ).optional()
}).catchall(z.unknown());

export function extractMcpToolResultText(input: unknown): unknown {
    if (typeof input !== "object" || input === null) {
        return input;
    }

    const res = ZodMcpToolResult.safeParse(input);
    if (res.success) {
        if (res.data.structuredContent?.result !== undefined) {
            return res.data.structuredContent.result;
        }
        if (res.data.content && res.data.content.length > 0 && res.data.content[0]?.text !== undefined) {
            return res.data.content[0].text;
        }
    }

    // Fallback: return the original object if parsing doesn't reveal standard MCP wrappers
    return input;
}
