"use strict";
/**
 * Zod validation schemas for MCP tool responses.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZodMcpToolResult = void 0;
exports.extractMcpToolResultText = extractMcpToolResultText;
var zod_1 = require("zod");
exports.ZodMcpToolResult = zod_1.z.object({
    structuredContent: zod_1.z.object({
        result: zod_1.z.unknown()
    }).catchall(zod_1.z.unknown()).optional(),
    content: zod_1.z.array(zod_1.z.object({
        text: zod_1.z.string().optional()
    }).catchall(zod_1.z.unknown())).optional()
}).catchall(zod_1.z.unknown());
function extractMcpToolResultText(input) {
    var _a, _b;
    if (typeof input !== "object" || input === null) {
        return input;
    }
    var res = exports.ZodMcpToolResult.safeParse(input);
    if (res.success) {
        if (((_a = res.data.structuredContent) === null || _a === void 0 ? void 0 : _a.result) !== undefined) {
            return res.data.structuredContent.result;
        }
        if (res.data.content && res.data.content.length > 0 && ((_b = res.data.content[0]) === null || _b === void 0 ? void 0 : _b.text) !== undefined) {
            return res.data.content[0].text;
        }
    }
    // Fallback: return the original object if parsing doesn't reveal standard MCP wrappers
    return input;
}
