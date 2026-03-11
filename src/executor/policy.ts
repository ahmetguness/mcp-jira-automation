import { createLogger } from "../logger.js";

const log = createLogger("executor:policy");

export type ExecPolicy = "strict" | "permissive";

interface AllowedCommand {
    bin: string;
    subcommands?: string[];
    standalone?: boolean;
    validate?: (tokens: string[], policy: ExecPolicy) => boolean;
}

/** Block shell injection / redirection / chaining */
const FORBIDDEN_CHARS = /[;&|`$<>()[\]{}!\n\r\\]/;

function tokenize(cmd: string): string[] {
    return cmd.trim().split(/\s+/).filter(Boolean);
}

function isFlag(t: string) {
    return t.startsWith("-");
}

function isSafeScriptName(name: string): boolean {
    return /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(name);
}

function isSafePkgSpecifier(spec: string): boolean {
    // allow: pkg, @scope/pkg, pkg@1.2.3
    // block: urls, file:, git+, ../, /abs
    return /^(@?[\w.-]+\/)?[\w.-]+(@[\w.+-]+)?$/.test(spec);
}

function hasPkgInstallArg(tokens: string[]) {
    return tokens.length >= 3 && !isFlag(tokens[2]!);
}

/** npm */
function validateNpm(tokens: string[], policy: ExecPolicy): boolean {
    const sub = tokens[1];
    if (!sub) return false;

    if (sub === "ci") return true;
    if (sub === "test") return true;

    if (sub === "run") {
        const script = tokens[2];
        if (!script) return false;
        return isSafeScriptName(script);
    }

    if (sub === "install") {
        if (policy === "strict") {
            // strict: allow only "npm install" or "npm install --flags" (NO "npm install <pkg>")
            return !hasPkgInstallArg(tokens);
        }
        // permissive: allow safe pkg spec
        if (!hasPkgInstallArg(tokens)) return true;
        return isSafePkgSpecifier(tokens[2]!);
    }

    return false;
}

function validatePipInstallArgs(tokens: string[], startIndex: number, policy: ExecPolicy): boolean {
    if (policy !== "strict") return true;

    for (let i = startIndex; i < tokens.length; i++) {
        const t = tokens[i]!;
        if (isFlag(t)) continue;
        if (t === "." || t === "requirements.txt") continue;
        if (!isSafePkgSpecifier(t)) return false;
    }
    return true;
}

/** python / python3 */
function validatePython(tokens: string[], policy: ExecPolicy): boolean {
    const sub = tokens[1];
    if (sub !== "-m") return false;

    const mod = tokens[2];
    if (!mod) return false;

    if (mod === "pytest") {
        // python -m pytest ...
        return true;
    }

    if (mod === "pip") {
        // python -m pip install ...
        const pipSub = tokens[3];
        if (pipSub !== "install") return false;
        return validatePipInstallArgs(tokens, 4, policy);
    }

    return false;
}

/** pip / pip3 */
function validatePip(tokens: string[], policy: ExecPolicy): boolean {
    const sub = tokens[1];
    if (sub !== "install") return false;
    return validatePipInstallArgs(tokens, 2, policy);
}

/** pytest standalone (gevşeklik) */
function validatePytest(_tokens: string[], _policy: ExecPolicy): boolean {
    // allow: pytest or pytest <file/args>
    // already protected by forbidden chars + no shell operators
    return true;
}

/** go */
function validateGo(tokens: string[]): boolean {
    const sub = tokens[1];
    if (!sub) return false;
    if (sub === "test") return true;
    if (sub === "mod") return tokens[2] === "download";
    return false;
}

/** rust */
function validateCargo(tokens: string[]): boolean {
    const sub = tokens[1];
    return sub === "test" || sub === "fetch";
}

/** java */
function validateMvn(tokens: string[]): boolean {
    const sub = tokens[1];
    return ["test", "verify", "package", "dependency:resolve"].includes(sub ?? "");
}

function validateGradle(tokens: string[]): boolean {
    const sub = tokens[1];
    return ["test", "build", "dependencies"].includes(sub ?? "");
}

/** git read-only */
function validateGit(tokens: string[]): boolean {
    const sub = tokens[1];
    return ["status", "log", "diff", "branch"].includes(sub ?? "");
}

/** npx is risky */
const NPX_SAFE_TOOLS = new Set(["eslint", "prettier", "tsc"]);
function validateNpx(tokens: string[], policy: ExecPolicy): boolean {
    if (policy === "strict") return false;
    const tool = tokens[1];
    if (!tool) return false;
    if (!/^[\w@/.-]+$/.test(tool)) return false;
    return NPX_SAFE_TOOLS.has(tool);
}

/** node - allow test file execution */
function validateNode(tokens: string[], policy: ExecPolicy): boolean {
    const file = tokens[1];
    if (!file) return false;
    
    // In strict mode, only allow test files
    if (policy === "strict") {
        // Allow test-*.js, *.test.js, *.spec.js, tests/*.js
        const isTestFile = /^(test-[\w-]+\.js|[\w-]+\.(test|spec)\.js|tests\/[\w-]+\.js)$/.test(file);
        if (!isTestFile) {
            return false;
        }
    }
    
    // Check for safe filename (no path traversal, no special chars)
    if (!/^[\w/.-]+\.js$/.test(file)) return false;
    
    return true;
}

const ALLOWLIST: AllowedCommand[] = [
    { bin: "npm", subcommands: ["ci", "install", "test", "run"], validate: validateNpm },
    { bin: "pnpm", subcommands: ["install", "test", "run"], validate: () => true },
    { bin: "yarn", subcommands: ["install", "test", "run"], validate: () => true },
    { bin: "bun", subcommands: ["install", "test", "run"], validate: () => true },
    { bin: "npx", validate: validateNpx },
    
    // Node.js direct execution - allow test files in strict mode
    { bin: "node", validate: validateNode },

    // Python
    { bin: "python", subcommands: ["-m"], validate: validatePython },
    { bin: "python3", subcommands: ["-m"], validate: validatePython },
    { bin: "pip", subcommands: ["install"], validate: validatePip },
    { bin: "pip3", subcommands: ["install"], validate: validatePip },
    { bin: "pytest", standalone: true, validate: validatePytest }, // ✅ allow pytest

    // Go
    { bin: "go", subcommands: ["test", "mod"], validate: (t) => validateGo(t) },

    // Java
    { bin: "mvn", subcommands: ["test", "verify", "package", "dependency:resolve"], validate: (t) => validateMvn(t) },
    { bin: "gradle", subcommands: ["test", "build", "dependencies"], validate: (t) => validateGradle(t) },
    { bin: "./gradlew", subcommands: ["test", "build", "dependencies"], validate: (t) => validateGradle(t) },

    // Rust
    { bin: "cargo", subcommands: ["test", "fetch"], validate: (t) => validateCargo(t) },

    // .NET
    { bin: "dotnet", subcommands: ["test"], validate: () => true },

    // Build
    { bin: "make", subcommands: ["test", "build", "check"], validate: () => true },

    // Safe utilities
    { bin: "cat", standalone: true },
    { bin: "ls", standalone: true },
    { bin: "pwd", standalone: true },
    { bin: "echo", standalone: true },

    // Git read-only
    { bin: "git", subcommands: ["status", "log", "diff", "branch"], validate: (t) => validateGit(t) },
];

export function isCommandAllowed(command: string, policy: ExecPolicy): boolean {
    const trimmed = command.trim();
    if (!trimmed) return false;

    if (FORBIDDEN_CHARS.test(trimmed)) {
        log.warn(`Command BLOCKED (forbidden characters): ${trimmed}`);
        return false;
    }

    const tokens = tokenize(trimmed);
    if (tokens.length === 0) return false;

    const bin = tokens[0]!;
    const sub = tokens[1];

    const match = ALLOWLIST.find((a) => a.bin === bin);
    if (!match) {
        if (policy === "strict") {
            log.warn(`Command BLOCKED (not in allowlist): ${trimmed}`);
            return false;
        }
        // permissive mode: allow if no forbidden chars (already checked above)
        log.info(`Command ALLOWED (permissive mode, no forbidden chars): ${trimmed}`);
        return true;
    }

    if (match.standalone) {
        // In strict mode, standalone only applies to simple utilities
        // This prevents commands like "node server.js" from bypassing strict mode checks
        if (policy === "strict") {
            // Allow simple utilities: cat, ls, pwd, echo, pytest
            const simpleUtils = ["cat", "ls", "pwd", "echo", "pytest"];
            if (!simpleUtils.includes(bin)) {
                log.warn(`Command BLOCKED (standalone binary '${bin}' not allowed in strict mode): ${trimmed}`);
                return false;
            }
        }
        return true;
    }

    if (match.subcommands) {
        if (!sub || !match.subcommands.includes(sub)) {
            if (policy === "strict") {
                log.warn(`Command BLOCKED (invalid subcommand '${sub ?? ""}' for ${bin}): ${trimmed}`);
                return false;
            }
            // permissive mode: allow if no forbidden chars (already checked above)
            log.info(`Command ALLOWED (permissive mode, no forbidden chars): ${trimmed}`);
            return true;
        }
    }

    if (match.validate && !match.validate(tokens, policy)) {
        if (policy === "strict") {
            log.warn(`Command BLOCKED (validator failed for ${bin}): ${trimmed}`);
            return false;
        }
        // permissive mode: allow if no forbidden chars (already checked above)
        log.info(`Command ALLOWED (permissive mode, no forbidden chars): ${trimmed}`);
        return true;
    }

    return true;
}

export function filterCommands(
    commands: string[],
    policy: ExecPolicy,
): { allowed: string[]; blocked: string[] } {
    const allowed: string[] = [];
    const blocked: string[] = [];

    for (const cmd of commands) {
        if (isCommandAllowed(cmd, policy)) allowed.push(cmd);
        else blocked.push(cmd);
    }

    return { allowed, blocked };
}