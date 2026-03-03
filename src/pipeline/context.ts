/**
 * TaskContext builder — determines which files to fetch from the repository.
 * Does NOT send the entire repo; selectively picks relevant files.
 */

import type { ScmProvider } from "../scm/index.js";
import type { JiraIssue, TaskContext, ScmFile, RepoInfo } from "../types.js";
import { createLogger } from "../logger.js";

const log = createLogger("pipeline:context");

/** File patterns that are typically source code */
const SOURCE_PATTERNS = [
    /\.(ts|tsx|js|jsx|py|go|java|rb|rs|cs|cpp|c|h|hpp|swift|kt|scala|php)$/i,
];

/** File patterns that are typically test files */
const TEST_PATTERNS = [
    /\.(test|spec|_test)\.(ts|tsx|js|jsx|py|go|java|rb|rs|cs|cpp)$/i,
    /^tests?\//i,
    /^__tests__\//i,
    /^spec\//i,
    /test_.*\.(py|rb)$/i,
    /_test\.go$/i,
];

/** Files to always include for context */
const CONTEXT_FILES = [
    "package.json",
    "tsconfig.json",
    "requirements.txt",
    "pyproject.toml",
    "go.mod",
    "pom.xml",
    "build.gradle",
    "Cargo.toml",
    "Makefile",
    "README.md",
];

/** Max files to include to avoid token limits */
const MAX_SOURCE_FILES = 30;
const MAX_TEST_FILES = 15;
const MAX_FILE_SIZE_CHARS = 10000;

export async function buildTaskContext(
    issue: JiraIssue,
    scm: ScmProvider,
    repo: string,
): Promise<TaskContext> {
    log.info(`Building context for ${issue.key} from ${repo}`);

    // Get repo info
    const repoInfo: RepoInfo = await scm.getRepoInfo(repo);
    const branch = repoInfo.defaultBranch;

    // List all files in the repo
    let allFiles: string[] = [];
    try {
        allFiles = await scm.listFiles(repo, undefined, branch);
    } catch (e) {
        log.warn(`Failed to fetch test files: ${String(e)}. Will try to read known file patterns.`);
    }

    // Categorize files
    const sourceFilePaths: string[] = [];
    const testFilePaths: string[] = [];
    const contextFilePaths: string[] = [];

    for (const f of allFiles) {
        if (CONTEXT_FILES.includes(f.split("/").pop() ?? "")) {
            contextFilePaths.push(f);
        } else if (TEST_PATTERNS.some((p) => p.test(f))) {
            testFilePaths.push(f);
        } else if (SOURCE_PATTERNS.some((p) => p.test(f))) {
            sourceFilePaths.push(f);
        }
    }

    // Prioritize files mentioned in the issue description
    const mentionedFiles = extractMentionedFiles(issue.description, allFiles);

    // Build final file lists with limits
    const prioritized = [
        ...mentionedFiles,
        ...contextFilePaths,
        ...sourceFilePaths.filter((f) => !mentionedFiles.includes(f)),
    ];
    const uniqueSource = [...new Set(prioritized)].slice(0, MAX_SOURCE_FILES);
    const uniqueTests = [...new Set(testFilePaths)].slice(0, MAX_TEST_FILES);

    // Read files
    log.info(`Reading ${uniqueSource.length} source + ${uniqueTests.length} test files`);

    const sourceFiles = await readFilesLimited(scm, repo, uniqueSource, branch);
    const testFiles = await readFilesLimited(scm, repo, uniqueTests, branch);

    log.info(`Context built: ${sourceFiles.length} source, ${testFiles.length} test files`);

    return {
        issue,
        repo: repoInfo,
        sourceFiles,
        testFiles,
    };
}

/** Extract file paths mentioned in the issue description */
function extractMentionedFiles(description: string, allFiles: string[]): string[] {
    if (!description) return [];

    const mentioned: string[] = [];
    for (const file of allFiles) {
        const basename = file.split("/").pop() ?? "";
        if (description.includes(basename) || description.includes(file)) {
            mentioned.push(file);
        }
    }
    return mentioned;
}

/** Read files with size limiting */
async function readFilesLimited(
    scm: ScmProvider,
    repo: string,
    paths: string[],
    branch: string,
): Promise<ScmFile[]> {
    const files: ScmFile[] = [];
    for (const p of paths) {
        try {
            let content = await scm.readFile(repo, p, branch);
            if (content.length > MAX_FILE_SIZE_CHARS) {
                content = content.slice(0, MAX_FILE_SIZE_CHARS) + "\n\n... [truncated]";
            }
            files.push({ path: p, content });
        } catch {
            // Skip files that can't be read
        }
    }
    return files;
}
