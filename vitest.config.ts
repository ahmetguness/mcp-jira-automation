import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
        passWithNoTests: true,
        env: {
            LOG_LEVEL: "silent",
        },
    },
});
