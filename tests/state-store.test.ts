import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StateStore } from "../src/state/store.js";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function tempStateFile(): string {
    return join(tmpdir(), `state-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe("StateStore", () => {
    let filePath: string;
    let store: StateStore;

    beforeEach(() => {
        filePath = tempStateFile();
        store = new StateStore(filePath);
    });

    afterEach(() => {
        try {
            if (existsSync(filePath)) unlinkSync(filePath);
        } catch { /* ignore */ }
    });

    // ── shouldProcess ────────────────────────────────────

    it("should process a brand new issue", () => {
        expect(store.shouldProcess("CYBER-1")).toBe(true);
    });

    it("should skip already succeeded issues", () => {
        store.lock("CYBER-1");
        store.markSuccess("CYBER-1", "https://pr.url");
        expect(store.shouldProcess("CYBER-1")).toBe(false);
    });

    it("should skip permanently_failed issues", () => {
        store.lock("CYBER-1");
        store.update("CYBER-1", "permanently_failed", { errorMessage: "fatal" });
        expect(store.shouldProcess("CYBER-1")).toBe(false);
    });

    it("should skip issues in cooldown", () => {
        store.lock("CYBER-1");
        const futureRetry = new Date(Date.now() + 60_000).toISOString();
        store.update("CYBER-1", "failed", { nextRetryAt: futureRetry });
        expect(store.shouldProcess("CYBER-1")).toBe(false);
    });

    it("should process issues whose cooldown has expired", () => {
        store.lock("CYBER-1");
        const pastRetry = new Date(Date.now() - 1000).toISOString();
        store.update("CYBER-1", "failed", { nextRetryAt: pastRetry });
        expect(store.shouldProcess("CYBER-1")).toBe(true);
    });

    it("should skip issues with approval_pending", () => {
        store.lock("CYBER-1");
        store.markApprovalPending("CYBER-1");
        expect(store.shouldProcess("CYBER-1")).toBe(false);
    });

    // ── lock ─────────────────────────────────────────────

    it("should acquire lock for a new issue", () => {
        expect(store.lock("CYBER-1")).toBe(true);
        const state = store.get("CYBER-1");
        expect(state?.status).toBe("processing");
        expect(state?.lockedAt).not.toBeNull();
    });

    it("should reject double lock on same issue", () => {
        store.lock("CYBER-1");
        expect(store.lock("CYBER-1")).toBe(false);
    });

    it("should increment attemptCount on each lock", () => {
        store.lock("CYBER-1");
        store.markFailed("CYBER-1", "error");
        // Now issue is in 'failed' state with no cooldown, so shouldProcess → true
        const pastRetry = new Date(Date.now() - 1000).toISOString();
        store.update("CYBER-1", "failed", { nextRetryAt: pastRetry });
        store.lock("CYBER-1");
        const state = store.get("CYBER-1");
        expect(state?.attemptCount).toBe(2);
    });

    // ── markSuccess / markFailed ─────────────────────────

    it("should markSuccess with PR url", () => {
        store.lock("CYBER-1");
        store.markSuccess("CYBER-1", "https://github.com/org/repo/pull/1");
        const state = store.get("CYBER-1");
        expect(state?.status).toBe("success");
        expect(state?.prUrl).toBe("https://github.com/org/repo/pull/1");
        expect(state?.lockedAt).toBeNull();
    });

    it("should markFailed with error message", () => {
        store.lock("CYBER-1");
        store.markFailed("CYBER-1", "Exit code: 1");
        const state = store.get("CYBER-1");
        expect(state?.status).toBe("failed");
        expect(state?.errorMessage).toBe("Exit code: 1");
        expect(state?.lockedAt).toBeNull();
    });

    // ── getByStatus ──────────────────────────────────────

    it("should return issues filtered by status", () => {
        store.lock("CYBER-1");
        store.markSuccess("CYBER-1");

        store.lock("CYBER-2");
        store.markFailed("CYBER-2", "err");

        store.lock("CYBER-3");
        store.markSuccess("CYBER-3");

        expect(store.getByStatus("success")).toHaveLength(2);
        expect(store.getByStatus("failed")).toHaveLength(1);
        expect(store.getByStatus("processing")).toHaveLength(0);
    });

    // ── persistence ──────────────────────────────────────

    it("should persist state to disk and reload", () => {
        store.lock("CYBER-1");
        store.markSuccess("CYBER-1", "https://pr.url");

        // Create a new store instance from the same file
        const store2 = new StateStore(filePath);
        const state = store2.get("CYBER-1");
        expect(state?.status).toBe("success");
        expect(state?.prUrl).toBe("https://pr.url");
    });

    it("should start fresh if state file is corrupt", async () => {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(filePath, "NOT VALID JSON!!!");

        const corruptStore = new StateStore(filePath);
        expect(corruptStore.get("CYBER-1")).toBeNull();
        expect(corruptStore.shouldProcess("CYBER-1")).toBe(true);
    });
});
