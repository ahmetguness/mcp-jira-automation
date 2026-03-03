/**
 * Structured logger with duration tracking for each pipeline step.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
    timestamp: string;
    level: LogLevel;
    component: string;
    message: string;
    duration_ms?: number;
    data?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let globalLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

export function setLogLevel(level: LogLevel): void {
    globalLevel = level;
}

function formatEntry(e: LogEntry): string {
    const lvl = e.level.toUpperCase().padEnd(5);
    const dur = e.duration_ms != null ? ` (${e.duration_ms}ms)` : "";
    const extra = e.data ? ` ${JSON.stringify(e.data)}` : "";
    return `${e.timestamp} [${lvl}] [${e.component}] ${e.message}${dur}${extra}`;
}

export function createLogger(component: string) {
    function log(level: LogLevel, message: string, data?: Record<string, unknown>, duration_ms?: number) {
        if (LEVEL_ORDER[level] < LEVEL_ORDER[globalLevel]) return;
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            component,
            message,
            duration_ms,
            data,
        };
        const line = formatEntry(entry);
        if (level === "error") {
            console.error(line);
        } else if (level === "warn") {
            console.warn(line);
        } else {
            console.log(line);
        }
    }

    return {
        debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
        info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
        warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
        error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
        /** Log with duration in ms */
        timed: (level: LogLevel, msg: string, duration_ms: number, data?: Record<string, unknown>) =>
            log(level, msg, data, duration_ms),
    };
}

/** Measure execution time of an async function */
export async function withTiming<T>(fn: () => Promise<T>): Promise<{ result: T; duration_ms: number }> {
    const start = performance.now();
    const result = await fn();
    const duration_ms = Math.round(performance.now() - start);
    return { result, duration_ms };
}
