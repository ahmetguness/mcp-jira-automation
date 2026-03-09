"use strict";
/**
 * Pino-backed structured logger.
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
exports.baseLogger = void 0;
exports.setLogContext = setLogContext;
exports.getLogContext = getLogContext;
exports.normalizeError = normalizeError;
exports.createLogger = createLogger;
exports.withTiming = withTiming;
var pino_1 = require("pino");
var node_crypto_1 = require("node:crypto");
var globalContext = {};
function setLogContext(ctx) {
    globalContext = __assign(__assign({}, globalContext), ctx);
}
function getLogContext() {
    return globalContext;
}
function normalizeError(err) {
    var msg = err instanceof Error ? err.message : String(err);
    // Detect GitHub 422 PR exists
    if ((msg.includes("Validation Failed") || msg.includes("422")) &&
        (msg.includes("pull_request") || msg.includes("A pull request already exists"))) {
        return {
            severity: "warn",
            message: "PR already exists",
            actionHint: "Open existing PR or reuse branch; do not retry PR creation",
            prExistsFlag: true,
            data: { http: 422, originalMessage: msg }
        };
    }
    // Detect missing repo field
    if (msg.includes("No repository found on issue")) {
        return {
            severity: "warn",
            message: "Missing Repository field",
            actionHint: "Set Repository custom field on Jira issue",
            data: { originalMessage: msg }
        };
    }
    // Detect MCP disconnect
    if (msg.includes("Connection closed") || msg.includes("disconnect") || msg.includes("read ECONNRESET")) {
        return {
            severity: "error",
            message: "MCP disconnected",
            actionHint: "Check if the MCP server crashed or network dropped",
            data: { originalMessage: msg }
        };
    }
    return {
        severity: "error",
        message: msg,
    };
}
// Generate unique ID per app session
var RUN_ID = node_crypto_1.default.randomUUID();
// Configure transport (JSON vs human-readable DEV)
var isJsonMode = process.env.LOG_FORMAT === "json" || process.env.NODE_ENV === "production";
var transportOptions = isJsonMode
    ? undefined
    : {
        target: "pino-pretty",
        options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname,runId",
            singleLine: true,
        },
    };
exports.baseLogger = (0, pino_1.pino)({
    level: process.env.LOG_LEVEL || "info",
    timestamp: pino_1.pino.stdTimeFunctions.isoTime,
    base: { runId: RUN_ID },
    transport: transportOptions,
});
/**
 * Ensures strict one physical line per log call message.
 * Any embedded newlines must be surfaced as spaces.
 */
function sanitizeMessage(msg) {
    return msg.replace(/\r?\n/g, " ");
}
function createLogger(scope) {
    var childLogger = exports.baseLogger.child({ scope: scope });
    function log(level, message, data, duration_ms) {
        var safeMessage = sanitizeMessage(message);
        var payload = __assign(__assign({}, globalContext), data);
        if (duration_ms !== undefined) {
            payload.duration_ms = duration_ms;
        }
        // Delegate to Pino
        if (level === "debug")
            childLogger.debug(payload, safeMessage);
        else if (level === "info")
            childLogger.info(payload, safeMessage);
        else if (level === "warn")
            childLogger.warn(payload, safeMessage);
        else
            childLogger.error(payload, safeMessage);
    }
    return {
        debug: function (msg, data) { return log("debug", msg, data); },
        info: function (msg, data) { return log("info", msg, data); },
        warn: function (msg, data) { return log("warn", msg, data); },
        error: function (msg, data) {
            if (msg instanceof Error || (typeof msg === "object" && msg !== null)) {
                var norm = normalizeError(msg);
                log(norm.severity, norm.message, __assign(__assign(__assign({}, data), { actionHint: norm.actionHint }), norm.data));
            }
            else {
                log("error", String(msg), data);
            }
        },
        /** Log with duration in ms */
        timed: function (level, msg, duration_ms, data) {
            return log(level, msg, data, duration_ms);
        },
        /** Normalizes and logs error, returns normalization object */
        normalizedError: function (err, data) {
            var norm = normalizeError(err);
            log(norm.severity, norm.message, __assign(__assign(__assign({}, data), { actionHint: norm.actionHint }), norm.data));
            return norm;
        }
    };
}
/** Measure execution time of an async function */
function withTiming(fn) {
    return __awaiter(this, void 0, void 0, function () {
        var start, result, duration_ms;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    start = performance.now();
                    return [4 /*yield*/, fn()];
                case 1:
                    result = _a.sent();
                    duration_ms = Math.round(performance.now() - start);
                    return [2 /*return*/, { result: result, duration_ms: duration_ms }];
            }
        });
    });
}
