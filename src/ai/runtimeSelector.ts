export type Runtime = "node" | "python" | "go" | "rust" | "java" | "unknown";

export interface RuntimeDetection {
    lang: Runtime;
    confidence?: number;
    reason: string;
}

export interface RuntimeSelectionResult {
    primary: Runtime;
    detected: RuntimeDetection[];
    markers: string[];
    isMulti: boolean;
}

// Map file extensions to runtimes
const EXTENSION_MAP: Record<string, Runtime> = {
    ".ts": "node",
    ".tsx": "node",
    ".js": "node",
    ".jsx": "node",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
};

// Map marker files to runtimes
const MARKER_MAP: Record<string, Runtime> = {
    "package.json": "node",
    "package-lock.json": "node",
    "yarn.lock": "node",
    "pnpm-lock.yaml": "node",
    "requirements.txt": "python",
    "pyproject.toml": "python",
    "Pipfile": "python",
    "setup.py": "python",
    "go.mod": "go",
    "Cargo.toml": "rust",
    "pom.xml": "java",
    "build.gradle": "java",
};

export function determineRuntime(
    mentionedFiles: string[],
    testFiles: string[],
    allFiles: string[]
): RuntimeSelectionResult {
    const detected: RuntimeDetection[] = [];
    const markers: string[] = [];
    const runtimes = new Set<Runtime>();

    // Helper to add detection
    const addDetection = (lang: Runtime, reason: string, confidence = 1) => {
        detected.push({ lang, reason, confidence });
        runtimes.add(lang);
    };

    // 1. Issue scope (files mentioned in the Jira issue)
    if (mentionedFiles && mentionedFiles.length > 0) {
        for (const file of mentionedFiles) {
            const ext = getExtension(file);
            if (ext && EXTENSION_MAP[ext]) {
                addDetection(EXTENSION_MAP[ext] as Runtime, `Mentioned source file: ${file}`, 1.0);
            }
            const basename = getBasename(file);
            if (MARKER_MAP[basename]) {
                addDetection(MARKER_MAP[basename] as Runtime, `Mentioned marker file: ${file}`, 1.0);
            }
        }
    }

    // 2. Test files
    if (testFiles && testFiles.length > 0) {
        for (const file of testFiles) {
            const ext = getExtension(file);
            if (ext && EXTENSION_MAP[ext]) {
                addDetection(EXTENSION_MAP[ext] as Runtime, `Test file: ${file}`, 0.8);
            }
        }
    }

    // 3. Marker files
    if (allFiles && allFiles.length > 0) {
        for (const file of allFiles) {
            const basename = getBasename(file);
            if (MARKER_MAP[basename]) {
                markers.push(file);
                // Lower confidence for markers deep in the tree to prefer root markers
                const depth = file.split('/').length - 1;
                const confidence = depth === 0 ? 0.6 : Math.max(0.1, 0.6 - (depth * 0.1));
                addDetection(MARKER_MAP[basename] as Runtime, `Marker file: ${file}`, confidence);
            }
        }
    }

    // If no runtimes detected
    if (detected.length === 0) {
        return {
            primary: "unknown",
            detected: [],
            markers: [],
            isMulti: false
        };
    }

    // Group and score detections
    const scores: Record<Runtime, number> = {
        node: 0,
        python: 0,
        go: 0,
        rust: 0,
        java: 0,
        unknown: 0
    };

    for (const d of detected) {
        scores[d.lang] += d.confidence ?? 0;
    }

    // Find highest score
    let primary: Runtime = "unknown";
    let maxScore = -1;

    for (const [lang, score] of Object.entries(scores)) {
        if (score > maxScore && score > 0) {
            maxScore = score;
            primary = lang as Runtime;
        }
    }

    return {
        primary,
        detected,
        markers,
        isMulti: runtimes.size > 1
    };
}

function getExtension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    if (idx !== -1) {
        return filename.substring(idx).toLowerCase();
    }
    return '';
}

function getBasename(path: string): string {
    return path.split('/').pop() || path;
}
