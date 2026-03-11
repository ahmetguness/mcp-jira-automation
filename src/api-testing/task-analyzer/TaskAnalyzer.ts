/**
 * TaskAnalyzer - Initial ingress layer for Jira tasks
 * Feature: api-endpoint-testing-transformation
 * 
 * This module is responsible for analyzing raw Jira tasks, extracting basic
 * repository context, determining whether explicit endpoint extraction is needed,
 * and normalizing the task payload for downstream processing.
 */

import type { JiraTask, TaskAnalysisResult, RepositoryInfo } from '../models/types.js';
import { createLogger } from '../../logger.js';
import type { RepositoryResolver } from '../repository-resolver/RepositoryResolver.js';

const log = createLogger('api-testing:task-analyzer');

export class TaskAnalyzer {
  private repositoryResolver: RepositoryResolver;

  constructor(repositoryResolver: RepositoryResolver) {
    this.repositoryResolver = repositoryResolver;
    log.info('TaskAnalyzer initialized');
  }

  /**
   * Analyze a Jira task to determine its validity and processing requirements
   */
  public analyzeTask(task: JiraTask): TaskAnalysisResult {
    log.info(`Analyzing task ${task.key}`);

    const errors: string[] = [];
    const warnings: string[] = [];
    
    // 1. Validate basic task structure
    if (!task.description || task.description.trim() === '') {
      errors.push('Task description is empty.');
    }

    // 2. Resolve Repository Information
    let repository: RepositoryInfo | undefined;
    try {
      repository = this.repositoryResolver.resolveRepository(task);
    } catch (error) {
      errors.push(`Failed to resolve repository: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 3. Determine if endpoint parsing is required
    const requiresEndpointParsing = !task.labels?.includes('skip-endpoint-parsing');

    // 4. Normalize the description (strip out noise if needed)
    const normalizedDescription = task.description?.trim() || '';

    // 5. Detect ambiguity
    if (normalizedDescription && !normalizedDescription.includes('http') && requiresEndpointParsing) {
      warnings.push('No explicit base URL found in task description; tests may use a default environment URL.');
    }

    const isValid = errors.length === 0;

    log.info(`Task ${task.key} analysis complete`, { isValid, errorCount: errors.length, warningCount: warnings.length });

    return {
      isValid,
      requiresEndpointParsing,
      repository,
      normalizedDescription,
      errors,
      warnings
    };
  }
}
