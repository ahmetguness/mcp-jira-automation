import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        passWithNoTests: true,
        env: {
            LOG_LEVEL: "silent",
        },
    },
});
