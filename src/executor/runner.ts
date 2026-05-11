interface ExecutorRunOptions {
    repoUrl: string;
    branch: string;
    commands: string[];
    patches?: { path: string; content: string }[];
    environmentHint?: string;
    executionMode?: "remote" | "sandbox";
    apiBaseUrl?: string;
    credentials?: Record<string, string>;
}

export interface ExecutorRunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    patches?: { path: string; content: string; action: "create" | "modify" }[];
}

export interface CommandExecutor {
    checkConnection(): Promise<boolean>;
    run(opts: ExecutorRunOptions): Promise<ExecutorRunResult>;
}

