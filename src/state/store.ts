/**
 * JSON-file-based persistent state store for issue tracking.
 * Provides idempotency (skip already-processed issues) and locking.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { IssueState, IssueStatus } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("state");

interface StateData {
    issues: Record<string, IssueState>;
}

export class StateStore {
    private filePath: string;
    private data: StateData;
    private lockTimeoutMs = 5 * 60 * 1000; // 5 minutes

    constructor(filePath: string) {
        this.filePath = filePath;
        this.data = this.load();
    }

    private load(): StateData {
        try {
            if (existsSync(this.filePath)) {
                const raw = readFileSync(this.filePath, "utf-8");
                return JSON.parse(raw) as StateData;
            }
        } catch (e: unknown) {
            log.warn(`Failed to load state file, starting fresh: ${String(e)}`);
        }
        return { issues: {} };
    }

    private save(): void {
        const dir = dirname(this.filePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    }

    /** Get state for an issue, or null if never processed */
    get(issueKey: string): IssueState | null {
        return this.data.issues[issueKey] ?? null;
    }

    /** Check if an issue should be processed */
    shouldProcess(issueKey: string): boolean {
        const state = this.get(issueKey);
        if (!state) return true;

        // Already succeeded -> skip
        if (state.status === "success") return false;

        // Currently locked by another run
        if (state.lockedAt) {
            const lockedTime = new Date(state.lockedAt).getTime();
            const now = Date.now();
            if (now - lockedTime < this.lockTimeoutMs) {
                log.debug(`Issue ${issueKey} is locked, skipping`);
                return false;
            }
            // Lock expired, allow reprocessing
            log.warn(`Lock expired for ${issueKey}, allowing reprocessing`);
        }

        // Approval pending -> skip
        if (state.status === "approval_pending") return false;

        // Processing -> skip (unless lock expired above)
        if (state.status === "processing") return false;

        return true;
    }

    /** Acquire lock for processing */
    lock(issueKey: string): boolean {
        if (!this.shouldProcess(issueKey)) return false;

        const existing = this.get(issueKey);
        this.data.issues[issueKey] = {
            issueKey,
            status: "processing",
            lastProcessedAt: new Date().toISOString(),
            attemptCount: (existing?.attemptCount ?? 0) + 1,
            prUrl: existing?.prUrl ?? null,
            errorMessage: null,
            lockedAt: new Date().toISOString(),
        };
        this.save();
        log.info(`Locked issue ${issueKey} for processing (attempt ${this.data.issues[issueKey]!.attemptCount})`);
        return true;
    }

    /** Update state after processing */
    update(issueKey: string, status: IssueStatus, extra?: Partial<IssueState>): void {
        const existing = this.get(issueKey);
        if (!existing) return;

        this.data.issues[issueKey] = {
            ...existing,
            ...extra,
            status,
            lastProcessedAt: new Date().toISOString(),
            lockedAt: null, // Release lock
        };
        this.save();
        log.info(`Updated issue ${issueKey} -> ${status}`);
    }

    /** Mark as success */
    markSuccess(issueKey: string, prUrl?: string): void {
        this.update(issueKey, "success", { prUrl: prUrl ?? null, errorMessage: null });
    }

    /** Mark as failed */
    markFailed(issueKey: string, error: string): void {
        this.update(issueKey, "failed", { errorMessage: error });
    }

    /** Mark as pending approval */
    markApprovalPending(issueKey: string): void {
        this.update(issueKey, "approval_pending");
    }

    /** Get all issues with a specific status */
    getByStatus(status: IssueStatus): IssueState[] {
        return Object.values(this.data.issues).filter((s) => s.status === status);
    }
}
