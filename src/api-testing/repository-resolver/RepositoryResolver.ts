/**
 * RepositoryResolver class - Determines which repository contains the API being tested
 * Feature: api-endpoint-testing-transformation
 * Requirements: 1.1 (implicit - repository needed for context)
 */

import type { JiraTask, RepositoryInfo } from '../models/types.js';
import { ScmProvider } from '../models/enums.js';
import { createLogger } from '../../logger.js';

const log = createLogger('api-testing:repository-resolver');

/**
 * Configuration for RepositoryResolver
 */
export interface RepositoryResolverConfig {
  /** Default repository URL if no other source provides one */
  defaultRepositoryUrl?: string;
  /** Default branch name (default: "main") */
  defaultBranch?: string;
  /** Default clone depth for shallow clones (default: 1) */
  defaultCloneDepth?: number;
  /** Project-level repository mappings (projectKey -> repository URL) */
  projectMappings?: Record<string, string>;
  /** Custom field name for repository URL in Jira (default: "customfield_10100") */
  repositoryCustomFieldName?: string;
  /** SCM authentication token from environment */
  scmAuthToken?: string;
}

/**
 * RepositoryResolver - Determines which repository contains the API being tested
 * 
 * This class resolves repository information from multiple sources in priority order:
 * 1. Jira custom field (e.g., "Repository URL")
 * 2. Explicit mention in task description (e.g., `repo: https://github.com/...`)
 * 3. Project-level mapping configuration
 * 4. Default repository if configured
 */
export class RepositoryResolver {
  private config: RepositoryResolverConfig;

  constructor(config: RepositoryResolverConfig = {}) {
    this.config = {
      defaultBranch: 'main',
      defaultCloneDepth: 1,
      repositoryCustomFieldName: 'customfield_10100',
      ...config,
    };

    log.info('RepositoryResolver initialized', {
      hasDefaultRepo: !!config.defaultRepositoryUrl,
      projectMappingsCount: Object.keys(config.projectMappings ?? {}).length,
      customFieldName: this.config.repositoryCustomFieldName,
    });
  }

  /**
   * Resolve repository from multiple sources with priority-based resolution
   * Requirements: 1.1 (implicit - repository needed for context)
   * 
   * Priority order:
   * 1. Jira custom field
   * 2. Task description
   * 3. Project mapping
   * 4. Default repository
   * 
   * @param task - Jira task to resolve repository for
   * @returns RepositoryInfo with resolved repository details
   * @throws Error if no repository can be resolved from any source
   */
  resolveRepository(task: JiraTask): RepositoryInfo {
    log.debug(`Resolving repository for task ${task.key}`);

    // Priority 1: Check Jira custom field
    const customFieldRepo = this.getFromCustomField(task, this.config.repositoryCustomFieldName!);
    if (customFieldRepo) {
      log.info(`Resolved repository from custom field for ${task.key}`, { url: customFieldRepo });
      return this.buildRepositoryInfo(customFieldRepo);
    }

    // Priority 2: Check task description
    const descriptionRepo = this.getFromDescription(task.description);
    if (descriptionRepo) {
      log.info(`Resolved repository from description for ${task.key}`, { url: descriptionRepo });
      return this.buildRepositoryInfo(descriptionRepo);
    }

    // Priority 3: Check project mapping
    const projectRepo = this.getFromProjectMapping(task.projectKey);
    if (projectRepo) {
      log.info(`Resolved repository from project mapping for ${task.key}`, { 
        projectKey: task.projectKey,
        url: projectRepo,
      });
      return this.buildRepositoryInfo(projectRepo);
    }

    // Priority 4: Use default repository
    if (this.config.defaultRepositoryUrl) {
      log.info(`Using default repository for ${task.key}`, { url: this.config.defaultRepositoryUrl });
      return this.buildRepositoryInfo(this.config.defaultRepositoryUrl);
    }

    // No repository found from any source
    const error = `Unable to resolve repository for task ${task.key}. No repository found in custom field, description, project mapping, or default configuration.`;
    log.error(error);
    throw new Error(error);
  }

  /**
   * Extract repository URL from Jira custom field
   * Requirements: 1.1 (implicit - repository resolution)
   * 
   * @param task - Jira task with custom fields
   * @param fieldName - Custom field name to check (e.g., "customfield_10100")
   * @returns Repository URL if found, null otherwise
   */
  getFromCustomField(task: JiraTask, fieldName: string): string | null {
    log.debug(`Checking custom field ${fieldName} for task ${task.key}`);

    const fieldValue = task.customFields[fieldName];
    
    if (!fieldValue) {
      log.debug(`Custom field ${fieldName} not found or empty`);
      return null;
    }

    // Handle different custom field value types
    let repoUrl: string | null = null;

    if (typeof fieldValue === 'string') {
      repoUrl = fieldValue.trim();
    } else if (typeof fieldValue === 'object' && fieldValue !== null) {
      // Some custom fields return objects with value property
      const fieldObj = fieldValue as { value?: string; url?: string };
      repoUrl = (fieldObj.value ?? fieldObj.url ?? '').trim();
    }

    if (repoUrl && this.isValidRepositoryUrl(repoUrl)) {
      log.debug(`Found valid repository URL in custom field ${fieldName}`, { url: repoUrl });
      return repoUrl;
    }

    log.debug(`Custom field ${fieldName} does not contain a valid repository URL`);
    return null;
  }

  /**
   * Parse repository URL from task description
   * Requirements: 1.1 (implicit - repository resolution)
   * 
   * Looks for patterns like:
   * - repo: https://github.com/org/repo
   * - repository: https://github.com/org/repo
   * - Repository URL: https://github.com/org/repo
   * 
   * @param taskDescription - Task description text
   * @returns Repository URL if found, null otherwise
   */
  getFromDescription(taskDescription: string): string | null {
    log.debug('Parsing repository URL from task description');

    if (!taskDescription) {
      log.debug('Task description is empty');
      return null;
    }

    // Patterns to match repository URLs in description
    const patterns = [
      /repo(?:sitory)?\s*(?:url)?\s*:\s*(https?:\/\/[^\s]+)/i,
      /repository\s+url\s*:\s*(https?:\/\/[^\s]+)/i,
      /git\s+(?:url|repo)\s*:\s*(https?:\/\/[^\s]+)/i,
    ];

    for (const pattern of patterns) {
      const match = taskDescription.match(pattern);
      if (match && match[1]) {
        const repoUrl = match[1].trim();
        if (this.isValidRepositoryUrl(repoUrl)) {
          log.debug('Found valid repository URL in description', { url: repoUrl });
          return repoUrl;
        }
      }
    }

    log.debug('No valid repository URL found in description');
    return null;
  }

  /**
   * Lookup repository from project-level configuration
   * Requirements: 1.1 (implicit - repository resolution)
   * 
   * @param projectKey - Jira project key (e.g., "PROJ")
   * @returns Repository URL if mapping exists, null otherwise
   */
  getFromProjectMapping(projectKey: string): string | null {
    log.debug(`Looking up project mapping for ${projectKey}`);

    if (!this.config.projectMappings) {
      log.debug('No project mappings configured');
      return null;
    }

    const repoUrl = this.config.projectMappings[projectKey];
    
    if (repoUrl && this.isValidRepositoryUrl(repoUrl)) {
      log.debug(`Found repository mapping for project ${projectKey}`, { url: repoUrl });
      return repoUrl;
    }

    log.debug(`No repository mapping found for project ${projectKey}`);
    return null;
  }

  /**
   * Validate if a string is a valid repository URL
   * 
   * @param url - URL to validate
   * @returns true if valid repository URL, false otherwise
   */
  private isValidRepositoryUrl(url: string): boolean {
    if (!url) return false;

    try {
      const parsed = new URL(url);
      
      // Check if it's a valid HTTP/HTTPS URL
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return false;
      }

      // Check if it's from a known SCM provider
      const hostname = parsed.hostname.toLowerCase();
      const knownProviders = ['github.com', 'gitlab.com', 'bitbucket.org'];
      
      return knownProviders.some(provider => hostname.includes(provider));
    } catch {
      return false;
    }
  }

  /**
   * Detect SCM provider from repository URL
   * 
   * @param url - Repository URL
   * @returns ScmProvider enum value
   */
  private detectProvider(url: string): ScmProvider {
    const lowerUrl = url.toLowerCase();
    
    if (lowerUrl.includes('github.com')) {
      return ScmProvider.GITHUB;
    } else if (lowerUrl.includes('gitlab.com')) {
      return ScmProvider.GITLAB;
    } else if (lowerUrl.includes('bitbucket.org')) {
      return ScmProvider.BITBUCKET;
    }
    
    // Default to GitHub if unknown
    log.warn(`Unknown SCM provider for URL ${url}, defaulting to GitHub`);
    return ScmProvider.GITHUB;
  }

  /**
   * Build RepositoryInfo object from repository URL
   * 
   * @param url - Repository URL
   * @returns Complete RepositoryInfo object
   */
  private buildRepositoryInfo(url: string): RepositoryInfo {
    return {
      url,
      provider: this.detectProvider(url),
      branch: this.config.defaultBranch!,
      authToken: this.config.scmAuthToken ?? process.env.SCM_AUTH_TOKEN ?? '',
      cloneDepth: this.config.defaultCloneDepth!,
    };
  }
}
