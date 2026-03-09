"use strict";
/**
 * Spawn MCP servers as child processes with stdio transport.
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.connectJiraMcp = connectJiraMcp;
exports.connectScmMcp = connectScmMcp;
var index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
var sse_js_1 = require("@modelcontextprotocol/sdk/client/sse.js");
var stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
var logger_js_1 = require("../logger.js");
var log = (0, logger_js_1.createLogger)("mcp:spawn");
/** Connect to mcp-atlassian via SSE (already running externally) */
function connectJiraMcp(config) {
    return __awaiter(this, void 0, void 0, function () {
        var transport, client;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    log.info("Connecting to mcp-atlassian at ".concat(config.mcpAtlassianUrl));
                    transport = new sse_js_1.SSEClientTransport(new URL(config.mcpAtlassianUrl));
                    client = new index_js_1.Client({ name: "mcp-jira-automation", version: "1.0.0" });
                    return [4 /*yield*/, client.connect(transport)];
                case 1:
                    _a.sent();
                    log.info("Connected to mcp-atlassian ✅");
                    return [2 /*return*/, { client: client, transport: transport, name: "mcp-atlassian" }];
            }
        });
    });
}
/** Spawn SCM MCP server as a child process via stdio */
function connectScmMcp(config) {
    return __awaiter(this, void 0, void 0, function () {
        var _a, command, args, env, name, transport, stderrBuffer_1, client;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _a = getScmSpawnConfig(config), command = _a.command, args = _a.args, env = _a.env, name = _a.name;
                    log.info("Spawning SCM MCP server: ".concat(name, " (").concat(command, " ").concat(args.join(" "), ")"));
                    transport = new stdio_js_1.StdioClientTransport({
                        command: command,
                        args: args,
                        env: __assign(__assign({}, process.env), env),
                        stderr: "pipe",
                    });
                    if (transport.stderr) {
                        stderrBuffer_1 = "";
                        transport.stderr.on("data", function (chunk) {
                            var str = Buffer.isBuffer(chunk)
                                ? chunk.toString("utf-8")
                                : String(chunk);
                            stderrBuffer_1 += str;
                            var lines = stderrBuffer_1.split("\n");
                            // The last item is either an empty string (if it ended with \n) 
                            // or a partial line that we must buffer for the next chunk.
                            stderrBuffer_1 = lines.pop() || "";
                            for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
                                var rawLine = lines_1[_i];
                                var line = rawLine.trim();
                                if (!line)
                                    continue;
                                // Determine if it's an error level or just info based on content, defaulting to debug/info
                                if (line.toLowerCase().includes("error") || line.toLowerCase().includes("fatal")) {
                                    log.error(line, { provider: name });
                                }
                                else {
                                    log.debug(line, { provider: name });
                                }
                            }
                        });
                    }
                    client = new index_js_1.Client({ name: "mcp-jira-automation", version: "1.0.0" });
                    return [4 /*yield*/, client.connect(transport)];
                case 1:
                    _b.sent();
                    log.info("Connected to ".concat(name, " \u2705"));
                    return [2 /*return*/, { client: client, transport: transport, name: name }];
            }
        });
    });
}
function getScmSpawnConfig(config) {
    switch (config.scmProvider) {
        case "github":
            if (!config.githubToken)
                throw new Error("GITHUB_TOKEN is required when SCM_PROVIDER=github");
            return {
                command: "docker",
                args: [
                    "run", "--rm", "-i",
                    "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
                    "ghcr.io/github/github-mcp-server",
                ],
                env: { GITHUB_PERSONAL_ACCESS_TOKEN: config.githubToken },
                name: "github-mcp-server",
            };
        case "gitlab":
            if (!config.gitlabToken)
                throw new Error("GITLAB_TOKEN is required when SCM_PROVIDER=gitlab");
            return {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-gitlab"],
                env: {
                    GITLAB_PERSONAL_ACCESS_TOKEN: config.gitlabToken,
                    GITLAB_API_URL: "".concat(config.gitlabUrl, "/api/v4"),
                },
                name: "gitlab-mcp-server",
            };
        case "bitbucket":
            if (!config.bitbucketUsername || !config.bitbucketAppPassword) {
                throw new Error("BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD are required when SCM_PROVIDER=bitbucket");
            }
            return {
                command: "uvx",
                args: ["mcp-bitbucket"],
                env: __assign({ BITBUCKET_USERNAME: config.bitbucketUsername, BITBUCKET_APP_PASSWORD: config.bitbucketAppPassword }, (config.bitbucketWorkspace ? { BITBUCKET_WORKSPACE: config.bitbucketWorkspace } : {})),
                name: "mcp-bitbucket",
            };
        default:
            throw new Error("Unsupported SCM Provider: ".concat(String(config.scmProvider)));
    }
}
