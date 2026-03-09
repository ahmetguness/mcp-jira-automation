"use strict";
/**
 * MCP Manager — manages lifecycle of all MCP connections.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.McpManager = void 0;
var logger_js_1 = require("../logger.js");
var spawn_js_1 = require("./spawn.js");
var mcp_js_1 = require("../validation/mcp.js");
var log = (0, logger_js_1.createLogger)("mcp:manager");
/**
 * Unwraps common MCP tool return shapes into a usable JS value.
 * Handles:
 * - structuredContent.result
 * - content[0].text as JSON (or plain text)
 * - raw JSON string
 */
function unwrapMcpResult(raw) {
    var _a, _b, _c;
    // Case 1: Raw is already an object we can inspect
    if (raw && typeof raw === "object") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        var anyRaw = raw;
        var structured = (_a = anyRaw.structuredContent) === null || _a === void 0 ? void 0 : _a.result;
        if (structured !== undefined)
            return structured;
        var text = (_c = (_b = anyRaw.content) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.text;
        if (typeof text === "string") {
            var trimmed = text.trim();
            // Try JSON parse if it looks like JSON
            if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
                (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
                try {
                    return JSON.parse(trimmed);
                }
                catch (_d) {
                    // fallthrough to return plain text
                }
            }
            return trimmed;
        }
    }
    // Case 2: Raw is a string (sometimes already JSON)
    if (typeof raw === "string") {
        var trimmed = raw.trim();
        if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
            (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
            try {
                return JSON.parse(trimmed);
            }
            catch (_e) {
                return trimmed;
            }
        }
        return trimmed;
    }
    return raw;
}
var McpManager = /** @class */ (function () {
    function McpManager(config) {
        this.config = config;
        this.jira = null;
        this.scm = null;
    }
    /** Initialize all MCP connections */
    McpManager.prototype.connect = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a, jiraTools, _b, scmTools;
            return __generator(this, function (_c) {
                switch (_c.label) {
                    case 0:
                        log.info("Initializing MCP connections...");
                        _a = this;
                        return [4 /*yield*/, (0, spawn_js_1.connectJiraMcp)(this.config)];
                    case 1:
                        _a.jira = _c.sent();
                        return [4 /*yield*/, this.jira.client.listTools()];
                    case 2:
                        jiraTools = (_c.sent()).tools;
                        log.info("mcp-atlassian provides ".concat(jiraTools.length, " tools"));
                        _b = this;
                        return [4 /*yield*/, (0, spawn_js_1.connectScmMcp)(this.config)];
                    case 3:
                        _b.scm = _c.sent();
                        return [4 /*yield*/, this.scm.client.listTools()];
                    case 4:
                        scmTools = (_c.sent()).tools;
                        log.info("".concat(this.scm.name, " provides ").concat(scmTools.length, " tools"));
                        return [2 /*return*/];
                }
            });
        });
    };
    /** Get Jira MCP client */
    McpManager.prototype.getJiraClient = function () {
        if (!this.jira)
            throw new Error("Jira MCP not connected. Call connect() first.");
        return this.jira;
    };
    /** Get SCM MCP client */
    McpManager.prototype.getScmClient = function () {
        if (!this.scm)
            throw new Error("SCM MCP not connected. Call connect() first.");
        return this.scm;
    };
    /** Call a tool on a specific MCP server */
    McpManager.prototype.callTool = function (connection, name, args) {
        return __awaiter(this, void 0, void 0, function () {
            var result, extracted;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        log.debug("Calling ".concat(connection.name, "/").concat(name), args);
                        return [4 /*yield*/, connection.client.callTool({ name: name, arguments: args })];
                    case 1:
                        result = _a.sent();
                        extracted = (0, mcp_js_1.extractMcpToolResultText)(result);
                        // Normalize to a JS value:
                        // - If extracted is a JSON string, parse it
                        // - If it's already structured, keep it
                        // - If it's plain text, return it
                        return [2 /*return*/, unwrapMcpResult(extracted)];
                }
            });
        });
    };
    /** Call a Jira tool */
    McpManager.prototype.callJiraTool = function (name, args) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.callTool(this.getJiraClient(), name, args)];
            });
        });
    };
    /** Call an SCM tool */
    McpManager.prototype.callScmTool = function (name, args) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, this.callTool(this.getScmClient(), name, args)];
            });
        });
    };
    /** Gracefully close all connections */
    McpManager.prototype.close = function () {
        return __awaiter(this, void 0, void 0, function () {
            var tasks;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        log.info("Closing MCP connections...");
                        tasks = [];
                        if (this.jira) {
                            tasks.push(this.jira.client.close().catch(function (e) { return log.warn("Error closing Jira MCP: ".concat(String(e))); }));
                            this.jira = null;
                        }
                        if (this.scm) {
                            tasks.push(this.scm.client.close().catch(function (e) { return log.warn("Error closing SCM MCP: ".concat(String(e))); }));
                            this.scm = null;
                        }
                        return [4 /*yield*/, Promise.all(tasks)];
                    case 1:
                        _a.sent();
                        log.info("All MCP connections closed");
                        return [2 /*return*/];
                }
            });
        });
    };
    return McpManager;
}());
exports.McpManager = McpManager;
