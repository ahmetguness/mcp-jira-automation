"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineRuntime = determineRuntime;
// Map file extensions to runtimes
var EXTENSION_MAP = {
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
var MARKER_MAP = {
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
function determineRuntime(mentionedFiles, testFiles, allFiles) {
    var _a;
    var detected = [];
    var markers = [];
    var runtimes = new Set();
    // Helper to add detection
    var addDetection = function (lang, reason, confidence) {
        if (confidence === void 0) { confidence = 1; }
        detected.push({ lang: lang, reason: reason, confidence: confidence });
        runtimes.add(lang);
    };
    // 1. Issue scope (files mentioned in the Jira issue)
    if (mentionedFiles && mentionedFiles.length > 0) {
        for (var _i = 0, mentionedFiles_1 = mentionedFiles; _i < mentionedFiles_1.length; _i++) {
            var file = mentionedFiles_1[_i];
            var ext = getExtension(file);
            if (ext && EXTENSION_MAP[ext]) {
                addDetection(EXTENSION_MAP[ext], "Mentioned source file: ".concat(file), 1.0);
            }
            var basename = getBasename(file);
            if (MARKER_MAP[basename]) {
                addDetection(MARKER_MAP[basename], "Mentioned marker file: ".concat(file), 1.0);
            }
        }
    }
    // 2. Test files
    if (testFiles && testFiles.length > 0) {
        for (var _b = 0, testFiles_1 = testFiles; _b < testFiles_1.length; _b++) {
            var file = testFiles_1[_b];
            var ext = getExtension(file);
            if (ext && EXTENSION_MAP[ext]) {
                addDetection(EXTENSION_MAP[ext], "Test file: ".concat(file), 0.8);
            }
        }
    }
    // 3. Marker files
    if (allFiles && allFiles.length > 0) {
        for (var _c = 0, allFiles_1 = allFiles; _c < allFiles_1.length; _c++) {
            var file = allFiles_1[_c];
            var basename = getBasename(file);
            if (MARKER_MAP[basename]) {
                markers.push(file);
                // Lower confidence for markers deep in the tree to prefer root markers
                var depth = file.split('/').length - 1;
                var confidence = depth === 0 ? 0.6 : Math.max(0.1, 0.6 - (depth * 0.1));
                addDetection(MARKER_MAP[basename], "Marker file: ".concat(file), confidence);
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
    var scores = {
        node: 0,
        python: 0,
        go: 0,
        rust: 0,
        java: 0,
        unknown: 0
    };
    for (var _d = 0, detected_1 = detected; _d < detected_1.length; _d++) {
        var d = detected_1[_d];
        scores[d.lang] += (_a = d.confidence) !== null && _a !== void 0 ? _a : 0;
    }
    // Find highest score
    var primary = "unknown";
    var maxScore = -1;
    for (var _e = 0, _f = Object.entries(scores); _e < _f.length; _e++) {
        var _g = _f[_e], lang = _g[0], score = _g[1];
        if (score > maxScore && score > 0) {
            maxScore = score;
            primary = lang;
        }
    }
    return {
        primary: primary,
        detected: detected,
        markers: markers,
        isMulti: runtimes.size > 1
    };
}
function getExtension(filename) {
    var idx = filename.lastIndexOf('.');
    if (idx !== -1) {
        return filename.substring(idx).toLowerCase();
    }
    return '';
}
function getBasename(path) {
    return path.split('/').pop() || path;
}
