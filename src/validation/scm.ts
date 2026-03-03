/**
 * Zod validation schemas for SCM API responses (GitHub, GitLab, Bitbucket).
 */

import { z } from "zod";

// ─── GitHub ──────────────────────────────────────────────────

export const ZodGitHubRepo = z.object({
    full_name: z.string().optional(),
    default_branch: z.string().optional(),
    description: z.string().optional().nullable(),
}).catchall(z.unknown());

export const ZodGitHubFile = z.object({
    content: z.string().optional(),
    encoding: z.string().optional(),
    path: z.string().optional(),
    name: z.string().optional(),
}).catchall(z.unknown());

export const ZodGitHubPullRequest = z.object({
    html_url: z.string().optional(),
    url: z.string().optional(),
}).catchall(z.unknown());

// ─── GitLab ──────────────────────────────────────────────────

export const ZodGitLabProject = z.object({
    path_with_namespace: z.string().optional(),
    default_branch: z.string().optional(),
    description: z.string().optional().nullable(),
}).catchall(z.unknown());

export const ZodGitLabFile = z.object({
    content: z.string().optional(),
    encoding: z.string().optional(),
    path: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
}).catchall(z.unknown());

export const ZodGitLabMergeRequest = z.object({
    web_url: z.string().optional(),
    url: z.string().optional(),
}).catchall(z.unknown());

// ─── Bitbucket ───────────────────────────────────────────────

export const ZodBitbucketRepo = z.object({
    mainbranch: z.object({ name: z.string().optional() }).optional().nullable(),
    description: z.string().optional().nullable(),
}).catchall(z.unknown());

export const ZodBitbucketSearchResponse = z.object({
    values: z.array(ZodBitbucketRepo).optional(),
}).catchall(z.unknown());

export const ZodBitbucketFile = z.object({
    content: z.string().optional(),
}).catchall(z.unknown());

export const ZodBitbucketPullRequest = z.object({
    links: z.object({
        html: z.object({
            href: z.string().optional(),
        }).optional(),
    }).optional(),
    url: z.string().optional(),
}).catchall(z.unknown());

// ─── Parsers ─────────────────────────────────────────────────

export function parseGitHubRepo(input: unknown) {
    const res = ZodGitHubRepo.safeParse(input);
    if (!res.success) throw new Error(`Invalid GitHub Repo: ${res.error.message}`);
    return res.data;
}

export function parseGitHubFile(input: unknown) {
    if (typeof input === "string") return input;
    const res = ZodGitHubFile.safeParse(input);
    if (!res.success) throw new Error(`Invalid GitHub File: ${res.error.message}`);
    return res.data;
}

export function parseGitHubFileList(input: unknown) {
    const res = z.array(ZodGitHubFile).safeParse(input);
    if (!res.success) throw new Error(`Invalid GitHub File List: ${res.error.message}`);
    return res.data;
}

export function parseGitHubPullRequest(input: unknown) {
    const res = ZodGitHubPullRequest.safeParse(input);
    if (!res.success) throw new Error(`Invalid GitHub PR: ${res.error.message}`);
    return res.data;
}

export function parseGitLabProject(input: unknown) {
    const res = ZodGitLabProject.safeParse(input);
    if (!res.success) throw new Error(`Invalid GitLab Project: ${res.error.message}`);
    return res.data;
}

export function parseGitLabFile(input: unknown) {
    if (typeof input === "string") return input;
    const res = ZodGitLabFile.safeParse(input);
    if (!res.success) throw new Error(`Invalid GitLab File: ${res.error.message}`);
    return res.data;
}

export function parseGitLabFileList(input: unknown) {
    const res = z.array(ZodGitLabFile).safeParse(input);
    if (!res.success) throw new Error(`Invalid GitLab File List: ${res.error.message}`);
    return res.data;
}

export function parseGitLabMergeRequest(input: unknown) {
    const res = ZodGitLabMergeRequest.safeParse(input);
    if (!res.success) throw new Error(`Invalid GitLab MR: ${res.error.message}`);
    return res.data;
}

export function parseBitbucketSearchResponse(input: unknown) {
    const res = ZodBitbucketSearchResponse.safeParse(input);
    if (!res.success) throw new Error(`Invalid Bitbucket Search: ${res.error.message}`);
    return res.data;
}

export function parseBitbucketFile(input: unknown) {
    if (typeof input === "string") return input;
    const res = ZodBitbucketFile.safeParse(input);
    if (!res.success) throw new Error(`Invalid Bitbucket File: ${res.error.message}`);
    return res.data;
}

export function parseBitbucketPullRequest(input: unknown) {
    const res = ZodBitbucketPullRequest.safeParse(input);
    if (!res.success) throw new Error(`Invalid Bitbucket PR: ${res.error.message}`);
    return res.data;
}
