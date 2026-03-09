"use strict";
/**
 * Jira MCP client wrapper — provides typed methods for Jira operations.
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
exports.JiraClient = void 0;
exports.normalizeRepoUrl = normalizeRepoUrl;
var config_js_1 = require("../config.js");
var jira_js_1 = require("../validation/jira.js");
var logger_js_1 = require("../logger.js");
var log = (0, logger_js_1.createLogger)("jira:client");
var JiraClient = /** @class */ (function () {
    function JiraClient(mcp, config) {
        this.mcp = mcp;
        this.config = config;
        this.cachedRepoFieldId = null;
    }
    /** Search issues assigned to the AI bot */
    JiraClient.prototype.fetchBotIssues = function () {
        return __awaiter(this, arguments, void 0, function (limit) {
            var jql, rawResult, result, issues;
            var _this = this;
            var _a, _b, _c;
            if (limit === void 0) { limit = 20; }
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        jql = (0, config_js_1.buildBotJql)(this.config);
                        log.info("Fetching bot issues with JQL: ".concat(jql));
                        return [4 /*yield*/, this.mcp.callJiraTool("jira_search", {
                                jql: jql,
                                limit: limit,
                                fields: "summary,status,description,issuetype,assignee",
                            })];
                    case 1:
                        rawResult = _d.sent();
                        result = (0, jira_js_1.parseJiraSearchResponse)(rawResult);
                        issues = (_c = (_a = result === null || result === void 0 ? void 0 : result.issues) !== null && _a !== void 0 ? _a : (_b = result === null || result === void 0 ? void 0 : result.result) === null || _b === void 0 ? void 0 : _b.issues) !== null && _c !== void 0 ? _c : [];
                        return [2 /*return*/, issues.map(function (i) { return _this.parseIssue(i); })];
                }
            });
        });
    };
    /** Get a single issue by key */
    JiraClient.prototype.getIssue = function (issueKey) {
        return __awaiter(this, void 0, void 0, function () {
            var rawResult, result;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        log.debug("Getting issue ".concat(issueKey));
                        return [4 /*yield*/, this.mcp.callJiraTool("jira_get_issue", {
                                issue_key: issueKey,
                            })];
                    case 1:
                        rawResult = _a.sent();
                        result = (0, jira_js_1.parseJiraIssue)(rawResult);
                        return [2 /*return*/, this.parseIssue(result)];
                }
            });
        });
    };
    /** Auto-detect repository custom field ID */
    JiraClient.prototype.detectRepositoryFieldId = function () {
        return __awaiter(this, void 0, void 0, function () {
            var rawResult, fields, repoField, error_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.cachedRepoFieldId) {
                            return [2 /*return*/, this.cachedRepoFieldId];
                        }
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        log.info("Auto-detecting repository custom field...");
                        return [4 /*yield*/, this.mcp.callJiraTool("jira_get_fields", {})];
                    case 2:
                        rawResult = _a.sent();
                        fields = Array.isArray(rawResult) ? rawResult : [];
                        repoField = fields.find(function (field) {
                            var name = (field.name || "").toLowerCase();
                            var id = field.id || "";
                            return (id.startsWith("customfield_") &&
                                (name.includes("repository") || name.includes("repo")));
                        });
                        if (repoField) {
                            this.cachedRepoFieldId = repoField.id;
                            log.info("Auto-detected repository field: ".concat(repoField.name, " (").concat(repoField.id, ")"));
                            return [2 /*return*/, repoField.id];
                        }
                        log.warn("No repository custom field found. Please create a custom field named 'Repository'");
                        return [2 /*return*/, null];
                    case 3:
                        error_1 = _a.sent();
                        log.warn("Failed to auto-detect repository field: ".concat(String(error_1)));
                        return [2 /*return*/, null];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /** Read the repository field from an issue */
    JiraClient.prototype.getRepositoryField = function (issueKey) {
        return __awaiter(this, void 0, void 0, function () {
            var fieldId, rawResult, result, value, issue, parsed;
            var _a, _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        fieldId = this.config.jiraRepoFieldId;
                        if (!(!fieldId || fieldId === "customfield_XXXXX")) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.detectRepositoryFieldId()];
                    case 1:
                        fieldId = (_d.sent()) || undefined;
                        _d.label = 2;
                    case 2:
                        if (!fieldId) return [3 /*break*/, 4];
                        return [4 /*yield*/, this.mcp.callJiraTool("jira_get_issue", {
                                issue_key: issueKey,
                            })];
                    case 3:
                        rawResult = _d.sent();
                        result = (0, jira_js_1.parseJiraIssue)(rawResult);
                        value = (_c = (_b = (_a = result === null || result === void 0 ? void 0 : result.fields) === null || _a === void 0 ? void 0 : _a[fieldId]) !== null && _b !== void 0 ? _b : result === null || result === void 0 ? void 0 : result[fieldId]) !== null && _c !== void 0 ? _c : null;
                        if (value) {
                            return [2 /*return*/, normalizeRepoUrl(typeof value === "string" ? value : JSON.stringify(value))];
                        }
                        _d.label = 4;
                    case 4: return [4 /*yield*/, this.getIssue(issueKey)];
                    case 5:
                        issue = _d.sent();
                        parsed = parseRepoFromDescription(issue.description);
                        if (parsed) {
                            log.info("Repository found in description: ".concat(parsed));
                            return [2 /*return*/, parsed];
                        }
                        log.warn("No repository found for ".concat(issueKey));
                        return [2 /*return*/, null];
                }
            });
        });
    };
    /** Add a comment to an issue */
    JiraClient.prototype.addComment = function (issueKey, body) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        log.info("Adding comment to ".concat(issueKey));
                        return [4 /*yield*/, this.mcp.callJiraTool("jira_add_comment", {
                                issue_key: issueKey,
                                body: body,
                            })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /** Transition an issue to a new status */
    JiraClient.prototype.transitionIssue = function (issueKey, targetStatus) {
        return __awaiter(this, void 0, void 0, function () {
            var e_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        log.info("Transitioning ".concat(issueKey, " to \"").concat(targetStatus, "\""));
                        _a.label = 1;
                    case 1:
                        _a.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this.mcp.callJiraTool("jira_transition_issue", {
                                issue_key: issueKey,
                                target_status: targetStatus,
                            })];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        e_1 = _a.sent();
                        log.warn("Failed to transition ".concat(issueKey, ": ").concat(String(e_1)));
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        });
    };
    /** Update an issue field */
    JiraClient.prototype.updateIssue = function (issueKey, fields) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.mcp.callJiraTool("jira_update_issue", {
                            issue_key: issueKey,
                            fields: JSON.stringify(fields),
                        })];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    JiraClient.prototype.parseIssue = function (rawUnsafe) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2;
        var raw = (0, jira_js_1.parseJiraIssue)(rawUnsafe);
        return {
            key: (_b = (_a = raw.key) !== null && _a !== void 0 ? _a : raw.issue_key) !== null && _b !== void 0 ? _b : "?",
            summary: (_e = (_c = raw.summary) !== null && _c !== void 0 ? _c : (_d = raw.fields) === null || _d === void 0 ? void 0 : _d.summary) !== null && _e !== void 0 ? _e : "",
            description: (_h = (_f = raw.description) !== null && _f !== void 0 ? _f : (_g = raw.fields) === null || _g === void 0 ? void 0 : _g.description) !== null && _h !== void 0 ? _h : "",
            status: (_o = (_k = (_j = raw.status) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : (_m = (_l = raw.fields) === null || _l === void 0 ? void 0 : _l.status) === null || _m === void 0 ? void 0 : _m.name) !== null && _o !== void 0 ? _o : "Unknown",
            issueType: (_v = (_s = (_q = (_p = raw.issue_type) === null || _p === void 0 ? void 0 : _p.name) !== null && _q !== void 0 ? _q : (_r = raw.issuetype) === null || _r === void 0 ? void 0 : _r.name) !== null && _s !== void 0 ? _s : (_u = (_t = raw.fields) === null || _t === void 0 ? void 0 : _t.issuetype) === null || _u === void 0 ? void 0 : _u.name) !== null && _v !== void 0 ? _v : "Unknown",
            assignee: (_2 = (_z = (_x = (_w = raw.assignee) === null || _w === void 0 ? void 0 : _w.display_name) !== null && _x !== void 0 ? _x : (_y = raw.assignee) === null || _y === void 0 ? void 0 : _y.name) !== null && _z !== void 0 ? _z : (_1 = (_0 = raw.fields) === null || _0 === void 0 ? void 0 : _0.assignee) === null || _1 === void 0 ? void 0 : _1.displayName) !== null && _2 !== void 0 ? _2 : "Unassigned",
            repository: null, // Filled separately
            raw: raw,
        };
    };
    return JiraClient;
}());
exports.JiraClient = JiraClient;
// ─── Helpers ─────────────────────────────────────────────────
/** Normalize repository URL to org/repo format */
function normalizeRepoUrl(input) {
    var trimmed = input.trim();
    // Already in org/repo format
    if (/^[\w.-]+\/[\w.-]+(\/[\w.-]+)*$/.test(trimmed)) {
        return trimmed;
    }
    // Extract from URL (GitHub/GitLab/Bitbucket)
    try {
        var url = new URL(trimmed);
        var path = url.pathname.replace(/^\//, "").replace(/\.git$/, "").replace(/\/$/, "");
        if (path)
            return path;
    }
    catch (_a) {
        // Not a URL
    }
    return trimmed;
}
/** Try to parse repository from issue description */
function parseRepoFromDescription(description) {
    if (!description)
        return null;
    // Match patterns like "Repo: org/repo" or "Repository: https://github.com/org/repo"
    var patterns = [
        /Repo:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i,
        /Repository:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i,
        /(?:Repo|Repository):\s*(https?:\/\/[^\s]+)/i,
        /(?:github|gitlab|bitbucket)\.(?:com|org)\/([^\s]+)/i,
    ];
    for (var _i = 0, patterns_1 = patterns; _i < patterns_1.length; _i++) {
        var pattern = patterns_1[_i];
        var match = description.match(pattern);
        if (match === null || match === void 0 ? void 0 : match[1]) {
            return normalizeRepoUrl(match[1]);
        }
    }
    return null;
}
