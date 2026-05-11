/**
 * Pino-backed structured logger with a clean, readable dev format.
 */

import { pino } from "pino";
import crypto from "node:crypto";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LogContext {
    runId?: string;
    issueKey?: string;
    step?: string;
    provider?: string;
}

let globalContext: LogContext = {};

export function setLogContext(ctx: Partial<LogContext>): void {
    globalContext = { ...globalContext, ...ctx };
}

export function getLogContext(): LogContext {
    return globalContext;
}

export interface NormalizedError {
    message: string;
    severity: LogLevel;
    actionHint?: string;
    prExistsFlag?: boolean;
    data?: Record<string, unknown>;
}

export function normalizeError(err: unknown): NormalizedError {
    const msg = err instanceof Error ? err.message : String(err);

    if (
        (msg.includes("Validation Failed") || msg.includes("422")) &&
        (msg.includes("pull_request") || msg.includes("A pull request already exists"))
    ) {
        return {
            severity: "warn",
            message: "PR already exists",
            actionHint: "Open existing PR or reuse branch; do not retry PR creation",
            prExistsFlag: true,
            data: { http: 422, originalMessage: msg }
        };
    }

    if (msg.includes("No repository found on issue")) {
        return {
            severity: "warn",
            message: "Missing Repository field",
            actionHint: "Set Repository custom field on Jira issue",
            data: { originalMessage: msg }
        };
    }

    if (msg.includes("Connection closed") || msg.includes("disconnect") || msg.includes("read ECONNRESET")) {
        return {
            severity: "error",
            message: "MCP disconnected",
            actionHint: "Check if the MCP server crashed or network dropped",
            data: { originalMessage: msg }
        };
    }

    return { severity: "error", message: msg };
}

// ─── ANSI helpers ────────────────────────────────────────────

const C = {
    reset:   "\x1b[0m",
    bold:    "\x1b[1m",
    dim:     "\x1b[2m",
    // foreground
    gray:    "\x1b[90m",
    cyan:    "\x1b[36m",
    green:   "\x1b[32m",
    yellow:  "\x1b[33m",
    red:     "\x1b[31m",
    magenta: "\x1b[35m",
    white:   "\x1b[97m",
    blue:    "\x1b[34m",
};

function colorize(text: string, ...codes: string[]): string {
    return codes.join("") + text + C.reset;
}

// ─── Level config ─────────────────────────────────────────────

const LEVEL_CONFIG: Record<number, { label: string; color: string }> = {
    10: { label: "TRACE", color: C.gray },
    20: { label: "DEBUG", color: C.gray },
    30: { label: " INFO", color: C.cyan },
    40: { label: " WARN", color: C.yellow },
    50: { label: "ERROR", color: C.red },
    60: { label: "FATAL", color: C.red + C.bold },
};

// ─── Scope color rotation ─────────────────────────────────────

const SCOPE_COLORS = [C.cyan, C.magenta, C.blue, C.green, C.yellow];
const scopeColorMap = new Map<string, string>();
let scopeColorIdx = 0;

function getScopeColor(scope: string): string {
    if (!scopeColorMap.has(scope)) {
        scopeColorMap.set(scope, SCOPE_COLORS[scopeColorIdx % SCOPE_COLORS.length]!);
        scopeColorIdx++;
    }
    return scopeColorMap.get(scope)!;
}

// ─── Custom formatter ─────────────────────────────────────────

function formatLine(obj: Record<string, unknown>): string {
    const levelNum = typeof obj.level === "number" ? obj.level : 30;
    const levelCfg = LEVEL_CONFIG[levelNum] ?? { label: "?????", color: C.gray };

    // Timestamp
    const ts = typeof obj.time === "number"
        ? new Date(obj.time).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : "";

    // Scope
    const scope = typeof obj.scope === "string" ? obj.scope : "";
    const scopeColor = getScopeColor(scope);
    const scopeStr = scope
        ? colorize(scope.padEnd(20), scopeColor)
        : " ".repeat(20);

    // Level badge
    const levelStr = colorize(levelCfg.label, levelCfg.color, C.bold);

    // Message
    const msg = typeof obj.msg === "string" ? obj.msg : "";
    const msgColor = levelNum >= 50 ? C.red : levelNum >= 40 ? C.yellow : C.white;
    const msgStr = colorize(msg, msgColor);

    // Extra fields (issueKey, step, duration_ms, actionHint — skip internal fields)
    const SKIP = new Set(["level", "time", "pid", "hostname", "runId", "scope", "msg",
        "issueKey", "step", "provider", "source", "tests", "patches", "commands",
        "exitCode", "success", "prUrl", "duration_ms", "validationErrors"]);

    const extras: string[] = [];

    // issueKey as a badge
    if (typeof obj.issueKey === "string") {
        extras.push(colorize(`[${obj.issueKey}]`, C.cyan, C.bold));
    }

    // duration_ms as a timing hint — only show if not already in the message
    if (typeof obj.duration_ms === "number" && !msg.includes("s)")) {
        const sec = (obj.duration_ms / 1000).toFixed(1);
        extras.push(colorize(`(${sec}s)`, C.dim + C.gray));
    }

    // actionHint for errors
    if (typeof obj.actionHint === "string") {
        extras.push(colorize(`→ ${obj.actionHint}`, C.yellow));
    }

    // Any remaining unknown fields
    for (const [k, v] of Object.entries(obj)) {
        if (SKIP.has(k)) continue;
        if (v === undefined || v === null) continue;
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        extras.push(colorize(`${k}=${val}`, C.dim + C.gray));
    }

    const extrasStr = extras.length > 0 ? "  " + extras.join("  ") : "";

    return `${colorize(ts, C.dim + C.gray)}  ${levelStr}  ${scopeStr}  ${msgStr}${extrasStr}`;
}

// ─── Transport ────────────────────────────────────────────────

const RUN_ID = crypto.randomUUID();
const isJsonMode = process.env.LOG_FORMAT === "json" || process.env.NODE_ENV === "production";

let transportOptions: Parameters<typeof pino>[0]["transport"];

if (!isJsonMode) {
    transportOptions = {
        target: "pino-pretty",
        options: {
            colorize: false,
            translateTime: false,
            ignore: "pid,hostname",
            singleLine: true,
            // Use a minimal format — we override with our own formatter below
            messageFormat: "{msg}",
            customPrettifier: (value: unknown, key: string) => {
                if (key === "time") return "";
                return String(value);
            },
        },
    };
}

// ─── Custom write stream (dev mode) ──────────────────────────

class DevStream {
    write(data: string): void {
        try {
            const obj = JSON.parse(data) as Record<string, unknown>;
            process.stdout.write(formatLine(obj) + "\n");
        } catch {
            process.stdout.write(data);
        }
    }
}

export const baseLogger = isJsonMode
    ? pino({
        level: process.env.LOG_LEVEL || "info",
        timestamp: pino.stdTimeFunctions.isoTime,
        base: { runId: RUN_ID },
        enabled: process.env.LOG_LEVEL !== "silent",
    })
    : pino(
        {
            level: process.env.LOG_LEVEL || "info",
            timestamp: pino.stdTimeFunctions.epochTime,
            base: { runId: RUN_ID },
            enabled: process.env.LOG_LEVEL !== "silent",
        },
        new DevStream() as unknown as Parameters<typeof pino>[1],
    );

// ─── Logger factory ───────────────────────────────────────────

function sanitizeMessage(msg: string): string {
    return msg.replace(/\r?\n/g, " ");
}

export function createLogger(scope: string) {
    const childLogger = baseLogger.child({ scope });

    function log(level: LogLevel, message: string, data?: Record<string, unknown>, duration_ms?: number) {
        const safeMessage = sanitizeMessage(message);
        const payload: Record<string, unknown> = { ...globalContext, ...data };
        if (duration_ms !== undefined) payload.duration_ms = duration_ms;

        if (level === "debug") childLogger.debug(payload, safeMessage);
        else if (level === "info") childLogger.info(payload, safeMessage);
        else if (level === "warn") childLogger.warn(payload, safeMessage);
        else childLogger.error(payload, safeMessage);
    }

    return {
        debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
        info:  (msg: string, data?: Record<string, unknown>) => log("info",  msg, data),
        warn:  (msg: string, data?: Record<string, unknown>) => log("warn",  msg, data),
        error: (msg: unknown, data?: Record<string, unknown>) => {
            if (msg instanceof Error || (typeof msg === "object" && msg !== null)) {
                const norm = normalizeError(msg);
                log(norm.severity, norm.message, { ...data, actionHint: norm.actionHint, ...norm.data });
            } else {
                log("error", String(msg), data);
            }
        },
        timed: (level: LogLevel, msg: string, duration_ms: number, data?: Record<string, unknown>) =>
            log(level, msg, data, duration_ms),
        normalizedError: (err: unknown, data?: Record<string, unknown>): NormalizedError => {
            const norm = normalizeError(err);
            log(norm.severity, norm.message, { ...data, actionHint: norm.actionHint, ...norm.data });
            return norm;
        },
    };
}

export async function withTiming<T>(fn: () => Promise<T>): Promise<{ result: T; duration_ms: number }> {
    const start = performance.now();
    const result = await fn();
    const duration_ms = Math.round(performance.now() - start);
    return { result, duration_ms };
}
