/**
 * TestStrategyManager - Formulates deterministic test plans
 * Feature: api-endpoint-testing-transformation
 * 
 * Instead of asking AI to implicitly act as the test strategist, we construct a formal 
 * Test Plan that outlines exactly which types of tests are required (auth, RBAC, functional, contract).
 * This plan is fed to the AI for generation.
 */

import type { EndpointSpec, TestContext } from '../models/types.js';
import { AuthType } from '../models/enums.js';
import { createLogger } from '../../logger.js';

const log = createLogger('api-testing:strategy');

export interface TestPlan {
  targetEndpoints: EndpointSpec[];
  strategyConstraints: StrategyConstraints;
  globalCoverageRequirements: string[];
}

export interface StrategyConstraints {
  requireAuthTests: boolean;
  requireNegativeTests: boolean;
  requireContractValidation: boolean;
  requirePerformanceThresholds: boolean;
}

export class TestStrategyManager {
  /**
   * Determine exactly what needs to be tested based on the endpoints parsed
   * from Jira and the specifications discovered in the repository.
   * 
   * @param jiraRequestedEndpoints - Endpoints explicitly mentioned in the Jira task
   * @param discoveredSpecs - Comprehensive endpoint definitions from OpenAPI/Postman
   * @param context - The broader repository test context
   */
  public generateTestPlan(
    jiraRequestedEndpoints: EndpointSpec[],
    discoveredSpecs: EndpointSpec[],
    context: TestContext
  ): TestPlan {
    log.info(`Generating test plan for ${jiraRequestedEndpoints.length} requested endpoints`);

    // 1. Reconcile Jira requested endpoints with Discovered Specs
    // We want to test what's in Jira, but we want the rich definition from the repo's OpenAPI.
    const targetEndpoints: EndpointSpec[] = [];

    for (const req of jiraRequestedEndpoints) {
      // Find matching spec
      const repoSpec = discoveredSpecs.find(
        (s) => s.url.includes(req.url) && s.method === req.method
      );

      if (repoSpec) {
        log.debug(`Enriched Jira endpoint ${req.method} ${req.url} with OpenAPI spec definition`);
        // Merge them, preferring Jira constraints where explicit (e.g. testScenarios)
        const combinedScenarios = new Set<string>();
        if (repoSpec.testScenarios) repoSpec.testScenarios.forEach(s => combinedScenarios.add(s));
        if (req.testScenarios) req.testScenarios.forEach(s => combinedScenarios.add(s));
        
        targetEndpoints.push({
          ...repoSpec,
          ...req, // Overwrite OpenAPI defaults with explicit Jira requests
          headers: { ...(repoSpec.headers || {}), ...(req.headers || {}) },
          testScenarios: Array.from(combinedScenarios),
        });
      } else {
        log.debug(`No OpenAPI spec found for ${req.method} ${req.url}, proceeding with Jira definition only`);
        targetEndpoints.push(req);
      }
    }

    // 2. Formulate Constraints based on the set of endpoints and context
    const strategyConstraints: StrategyConstraints = {
      requireAuthTests: this.requiresAuthTesting(targetEndpoints),
      requireNegativeTests: true, // We should always generate 4xx tests for production-grade CI
      requireContractValidation: discoveredSpecs.length > 0, // If we found OpenAPI specs, we must validate against them
      requirePerformanceThresholds: targetEndpoints.some(e => e.performanceThresholdMs !== undefined),
    };

    // 3. Define Global Coverage Requirements for the AI prompts
    const globalCoverageRequirements: string[] = [];
    
    if (strategyConstraints.requireAuthTests) {
      globalCoverageRequirements.push('Must generate 401 Unauthorized assertions for endpoints requiring authentication.');
    }
    
    if (strategyConstraints.requireNegativeTests) {
      globalCoverageRequirements.push('Must generate boundary and invalid input assertions yielding 400 Bad Request.');
      globalCoverageRequirements.push('Must generate 404 Not Found tests for singular resource endpoints.');
    }

    if (strategyConstraints.requireContractValidation) {
      globalCoverageRequirements.push('Must assert that the response schema exactly matches the provided OpenAPI component schemas.');
    }

    log.info(`Test plan generated with ${targetEndpoints.length} endpoints and ${globalCoverageRequirements.length} coverage requirements`);
    
    return {
      targetEndpoints,
      strategyConstraints,
      globalCoverageRequirements,
    };
  }

  private requiresAuthTesting(endpoints: EndpointSpec[]): boolean {
    return endpoints.some(e => e.authType && e.authType !== AuthType.NONE);
  }
}
