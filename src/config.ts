export interface Config {
    jiraBaseUrl: string;
    jiraEmail: string;
    jiraApiToken: string;
    jiraProjectKey: string;
}

export function loadConfig(): Config {
    return {
        jiraBaseUrl: process.env.JIRA_BASE_URL ?? "",
        jiraEmail: process.env.JIRA_EMAIL ?? "",
        jiraApiToken: process.env.JIRA_API_TOKEN ?? "",
        jiraProjectKey: process.env.JIRA_PROJECT_KEY ?? "",
    };
}
