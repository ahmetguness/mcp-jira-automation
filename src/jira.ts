import type { Config } from "./config.js";

export class JiraClient {
    private config: Config;

    constructor(config: Config) {
        this.config = config;
    }

    get baseUrl(): string {
        return this.config.jiraBaseUrl;
    }

    // TODO: implement Jira REST API methods
}
