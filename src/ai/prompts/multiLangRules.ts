export function getMultiLangRules(): string {
    return `
MULTI-LANGUAGE REPOSITORY RULES:
- Exactly ONE runtime must be selected as the primary runtime for your commands.
- Commands must ONLY target the primary runtime.
- Secondary runtimes must NOT be modified unless explicitly required by the Jira issue.
- Never run dependency installs for two runtimes in the same execution.`;
}
