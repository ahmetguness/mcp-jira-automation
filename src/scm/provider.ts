/**
 * SCM provider interface — abstracts GitHub / GitLab / Bitbucket differences.
 */

import type { ScmFile, RepoInfo } from "../types.js";

export interface ScmProvider {
    /** Get repository metadata */
    getRepoInfo(repo: string): Promise<RepoInfo>;

    /** Read a single file from the repository */
    readFile(repo: string, path: string, branch?: string): Promise<string>;

    /** List files in a directory (recursive if supported) */
    listFiles(repo: string, path?: string, branch?: string): Promise<string[]>;

    /** Read multiple files at once */
    readFiles(repo: string, paths: string[], branch?: string): Promise<ScmFile[]>;

    /** Create a branch from a base branch */
    createBranch(repo: string, branchName: string, baseBranch?: string): Promise<void>;

    /** Write/update a file (commit to branch) */
    writeFile(
        repo: string,
        path: string,
        content: string,
        message: string,
        branch: string,
    ): Promise<void>;

    /** Create a pull request */
    createPullRequest(
        repo: string,
        title: string,
        body: string,
        sourceBranch: string,
        targetBranch?: string,
    ): Promise<string>; // returns PR URL
}
