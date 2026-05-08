/**
 * Container environment variable builder — constructs the env vars
 * injected into Docker containers for test execution.
 *
 * Extracted from docker.ts. Hardcoded test credentials are now loaded
 * from config (CONTAINER_TEST_ENV in .env) with sensible defaults.
 */

import { createLogger } from "../logger.js";
import { LANGUAGE_ENV, type ProjectLanguage } from "./project-detector.js";

const log = createLogger("executor:env");

export interface ContainerEnvOptions {
    language: ProjectLanguage;
    executionMode?: "remote" | "sandbox";
    apiBaseUrl?: string;
    credentials?: Record<string, string>;
    detectedDatabases: string[];
    databaseEnvVars: string[];
    /** Additional test env vars from config (parsed from CONTAINER_TEST_ENV) */
    testEnvOverrides?: Record<string, string>;
}

/**
 * Default test environment variables. These are injected into every container
 * so that applications don't crash on missing env vars during testing.
 *
 * Override any of these by setting CONTAINER_TEST_ENV in your .env file:
 *   CONTAINER_TEST_ENV=JWT_SECRET=my-custom-secret,API_KEY=my-key
 */
const DEFAULT_TEST_ENV: Record<string, string> = {
    JWT_SECRET: "test-secret-key-for-testing-only-do-not-use-in-production",
    JWT_ACCESS_EXPIRATION_MINUTES: "30",
    JWT_REFRESH_EXPIRATION_DAYS: "30",
    JWT_RESET_PASSWORD_EXPIRATION_MINUTES: "10",
    JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: "10",
    API_KEY: "test-api-key",
    SESSION_SECRET: "test-session-secret-for-testing-only",
    ENCRYPTION_KEY: "test-encryption-key-32-chars!!",
    SMTP_HOST: "localhost",
    SMTP_PORT: "1025",
    SMTP_USERNAME: "test",
    SMTP_PASSWORD: "test",
    EMAIL_FROM: "test@example.com",
    CLOUDINARY_CLOUD_NAME: "test-cloud",
    CLOUDINARY_API_KEY: "test-cloudinary-key",
    CLOUDINARY_API_SECRET: "test-cloudinary-secret",
    AWS_ACCESS_KEY_ID: "test-aws-key",
    AWS_SECRET_ACCESS_KEY: "test-aws-secret",
    AWS_REGION: "us-east-1",
    S3_BUCKET: "test-bucket",
    STRIPE_SECRET_KEY: "sk_test_fake_key",
    STRIPE_PUBLISHABLE_KEY: "pk_test_fake_key",
};

/**
 * Build the full environment variable array for a Docker container.
 */
export function buildContainerEnv(opts: ContainerEnvOptions): string[] {
    const envVars = [
        "DEBIAN_FRONTEND=noninteractive",
        "HOME=/root",
        "NO_COLOR=1",
        "FORCE_COLOR=0",
        ...LANGUAGE_ENV[opts.language],
    ];

    // Merge default test env with overrides from config
    const testEnv = { ...DEFAULT_TEST_ENV, ...opts.testEnvOverrides };
    for (const [key, value] of Object.entries(testEnv)) {
        envVars.push(`${key}=${value}`);
    }

    // Add database env vars
    if (opts.databaseEnvVars.length > 0) {
        envVars.push(...opts.databaseEnvVars);
    }

    // Fallback DATABASE_URL and MONGODB_URL if not already set
    const hasDbUrl = envVars.some(v => v.startsWith('DATABASE_URL='));
    const hasMongoUrl = envVars.some(v => v.startsWith('MONGODB_URL='));
    if (!hasDbUrl) {
        envVars.push('DATABASE_URL=postgresql://postgres:postgres@localhost:5432/test');
    }
    if (!hasMongoUrl) {
        envVars.push('MONGODB_URL=mongodb://localhost:27017/test');
    }

    // Remote mode: pass API_BASE_URL
    if (opts.executionMode === "remote" && opts.apiBaseUrl) {
        envVars.push(`API_BASE_URL=${opts.apiBaseUrl}`);
        log.info(`🌐 Remote mode: tests will target ${opts.apiBaseUrl}`);
    }

    // Task-level credentials from Jira custom field
    if (opts.credentials && Object.keys(opts.credentials).length > 0) {
        for (const [key, value] of Object.entries(opts.credentials)) {
            envVars.push(`${key}=${value}`);
        }
        log.info(`🔑 Credentials injected: ${Object.keys(opts.credentials).length} variable(s) (keys and values redacted)`);
    }

    return envVars;
}

/**
 * Parse CONTAINER_TEST_ENV from config string.
 * Format: "KEY1=value1,KEY2=value2" or "KEY1=value1\nKEY2=value2"
 */
export function parseContainerTestEnv(raw?: string): Record<string, string> {
    if (!raw) return {};
    const result: Record<string, string> = {};
    // Split by comma or newline
    const entries = raw.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    for (const entry of entries) {
        const eqIdx = entry.indexOf('=');
        if (eqIdx > 0) {
            const key = entry.slice(0, eqIdx).trim();
            const value = entry.slice(eqIdx + 1).trim();
            result[key] = value;
        }
    }
    return result;
}
