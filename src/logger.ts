/**
 * Pino-backed structured logger.
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

    // Detect GitHub 422 PR exists
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
const RUN_ID = crypto.randomUUID();

// Configure transport (JSON vs human-readable DEV)
const isJsonMode = process.env.LOG_FORMAT === "json" || process.env.NODE_ENV === "production";

const transportOptions = isJsonMode
    ? undefined
    : {
        target: "pino-pretty",
        options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname,runId,scope",
            singleLine: false,
            messageFormat: "{scope} | {msg}",
            customColors: "info:cyan,warn:yellow,error:red",
        },
    };

export const baseLogger = pino({
    level: process.env.LOG_LEVEL || "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { runId: RUN_ID },
    transport: transportOptions,
    // Suppress all logs when LOG_LEVEL is "silent"
    enabled: process.env.LOG_LEVEL !== "silent",
});

/**
 * Ensures strict one physical line per log call message. 
 * Any embedded newlines must be surfaced as spaces.
 */
function sanitizeMessage(msg: string): string {
    return msg.replace(/\r?\n/g, " ");
}

export function createLogger(scope: string) {
    const childLogger = baseLogger.child({ scope });

    function log(level: LogLevel, message: string, data?: Record<string, unknown>, duration_ms?: number) {
        const safeMessage = sanitizeMessage(message);
        const payload: Record<string, unknown> = { ...globalContext, ...data };

        if (duration_ms !== undefined) {
            payload.duration_ms = duration_ms;
        }

        // Delegate to Pino
        if (level === "debug") childLogger.debug(payload, safeMessage);
        else if (level === "info") childLogger.info(payload, safeMessage);
        else if (level === "warn") childLogger.warn(payload, safeMessage);
        else childLogger.error(payload, safeMessage);
    }

    return {
        debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
        info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
        warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
        error: (msg: unknown, data?: Record<string, unknown>) => {
            if (msg instanceof Error || (typeof msg === "object" && msg !== null)) {
                const norm = normalizeError(msg);
                log(norm.severity, norm.message, { ...data, actionHint: norm.actionHint, ...norm.data });
            } else {
                log("error", String(msg), data);
            }
        },
        /** Log with duration in ms */
        timed: (level: LogLevel, msg: string, duration_ms: number, data?: Record<string, unknown>) =>
            log(level, msg, data, duration_ms),
        /** Normalizes and logs error, returns normalization object */
        normalizedError: (err: unknown, data?: Record<string, unknown>): NormalizedError => {
            const norm = normalizeError(err);
            log(norm.severity, norm.message, { ...data, actionHint: norm.actionHint, ...norm.data });
            return norm;
        }
    };
}

/** Measure execution time of an async function */
export async function withTiming<T>(fn: () => Promise<T>): Promise<{ result: T; duration_ms: number }> {
    const start = performance.now();
    const result = await fn();
    const duration_ms = Math.round(performance.now() - start);
    return { result, duration_ms };
}
