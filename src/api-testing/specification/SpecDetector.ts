/**
 * SpecDetector - Deterministically extracts structured API specifications from repository files.
 * Feature: api-endpoint-testing-transformation
 * 
 * Maps OpenAPI/Swagger documents and Postman collections into normalized EndpointSpec objects
 * to form a deterministic foundation for testing strategy rather than relying on AI guessing.
 */

import type { EndpointSpec, FileContent } from '../models/types.js';
import { HttpMethod, AuthType } from '../models/enums.js';
import { createLogger } from '../../logger.js';
import * as yaml from 'yaml';

const log = createLogger('api-testing:spec-detector');

export class SpecDetector {
  /**
   * Parse API specifications from files retrieved by RepositoryContextBuilder
   * 
   * @param files - Array of FileContent objects containing OpenAPI/Swagger/Postman specs
   * @returns Array of normalized EndpointSpec objects
   */
  public parseSpecifications(files: FileContent[]): EndpointSpec[] {
    const endpoints: EndpointSpec[] = [];

    for (const file of files) {
      log.debug(`Analyzing spec file: ${file.path}`);
      
      const fileExt = file.path.split('.').pop()?.toLowerCase();
      
      try {
        if (fileExt === 'json') {
          // Could be Postman or OpenAPI JSON
          const data = JSON.parse(file.content);
          if (data.info && data.item) {
            endpoints.push(...this.parsePostmanCollection(data));
          } else if (data.openapi || data.swagger) {
            endpoints.push(...this.parseOpenApiDoc(data));
          }
        } else if (fileExt === 'yaml' || fileExt === 'yml') {
          // Likely OpenAPI YAML
          const data = yaml.parse(file.content);
          if (data.openapi || data.swagger) {
            endpoints.push(...this.parseOpenApiDoc(data));
          }
        }
      } catch (error) {
        log.warn(`Failed to parse specification file ${file.path}`, { error });
      }
    }

    // Deduplicate endpoints based on method + url
    const uniqueMap = new Map<string, EndpointSpec>();
    for (const ep of endpoints) {
      const key = `${ep.method}:${ep.url}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, ep);
      }
    }

    const result = Array.from(uniqueMap.values());
    log.info(`Extracted ${result.length} unique endpoints from ${files.length} specification files`);
    return result;
  }

  /**
   * Parse OpenAPI / Swagger spec document
   */
  private parseOpenApiDoc(spec: any): EndpointSpec[] {
    const endpoints: EndpointSpec[] = [];
    
    if (!spec.paths) return endpoints;

    // Detect global security
    const globalAuth = this.detectOpenApiAuth(spec.security, spec.components?.securitySchemes);
    
    // Extract base servers
    let baseUrl = '';
    if (spec.servers && spec.servers.length > 0 && spec.servers[0].url) {
      baseUrl = spec.servers[0].url;
    } else if (spec.basePath) {
      baseUrl = spec.basePath; // Swagger 2.0 fallback
    }

    for (const [path, methodsObj] of Object.entries(spec.paths)) {
      if (!methodsObj || typeof methodsObj !== 'object') continue;

      for (const [methodRaw, details] of Object.entries(methodsObj)) {
        // Skip OpenAPI extensions or parameters at the path level
        if (methodRaw.startsWith('x-') || methodRaw === 'parameters' || methodRaw === 'servers') {
          continue;
        }

        const method = this.parseMethod(methodRaw);
        if (!method) continue; // Unknown method

        const operation = details as any;
        
        // Operation-level security overrides global
        const authType = operation.security 
          ? this.detectOpenApiAuth(operation.security, spec.components?.securitySchemes)
          : globalAuth;

        let expectedStatus = 200;
        if (operation.responses) {
          const successCodes = Object.keys(operation.responses)
            .filter(code => code.startsWith('2'))
            .map(Number)
            .sort();
          if (successCodes.length > 0 && successCodes[0] !== undefined) {
            expectedStatus = successCodes[0];
          }
        }

        const fullUrl = this.normalizeUrl(baseUrl, path);

        endpoints.push({
          url: fullUrl,
          method,
          headers: this.extractRequiredHeaders(operation.parameters),
          expectedStatus,
          authType,
          testScenarios: ['success'], // Default scenario, to be enriched by TestStrategy
        });
      }
    }

    return endpoints;
  }

  /**
   * Parse Postman Collection (v2.0 / v2.1)
   */
  private parsePostmanCollection(collection: any): EndpointSpec[] {
    const endpoints: EndpointSpec[] = [];
    
    if (!collection.item) return endpoints;

    const traverseItems = (items: any[]) => {
      for (const item of items) {
        if (item.item) {
          // Folder
          traverseItems(item.item);
        } else if (item.request) {
          // Request
          const req = item.request;
          const method = this.parseMethod(req.method);
          if (!method) continue;

          let url = '';
          if (typeof req.url === 'string') {
            url = req.url;
          } else if (req.url && req.url.raw) {
            url = req.url.raw;
          }

          // Replace Postman variables like {{baseUrl}} dynamically or leave as path variable
          // This is basic and can be improved
          url = url.replace(/\{\{[^}]+\}\}/g, 'var');

          const headers: Record<string, string> = {};
          if (Array.isArray(req.header)) {
            for (const h of req.header) {
              if (!h.disabled) headers[h.key] = h.value;
            }
          }

          let authType = AuthType.NONE;
          if (req.auth && req.auth.type) {
            authType = this.mapPostmanAuth(req.auth.type);
          }

          endpoints.push({
            url,
            method,
            headers,
            expectedStatus: 200, // Postman doesn't inherently declare Expected Status outside of test scripts
            authType,
            testScenarios: ['success'],
          });
        }
      }
    };

    traverseItems(collection.item);
    return endpoints;
  }

  private detectOpenApiAuth(securityRules: any[] | undefined, schemes: any): AuthType {
    if (!securityRules || securityRules.length === 0) return AuthType.NONE;
    if (!schemes) return AuthType.BASIC; // fallback guess

    // Look at first security rule
    const rule = securityRules[0];
    const schemeNames = Object.keys(rule);
    
    for (const name of schemeNames) {
      const schemeDef = schemes[name];
      if (!schemeDef) continue;
      
      if (schemeDef.type === 'http') {
        if (schemeDef.scheme === 'bearer') return AuthType.BEARER;
        if (schemeDef.scheme === 'basic') return AuthType.BASIC;
      }
      if (schemeDef.type === 'apiKey') return AuthType.API_KEY;
      if (schemeDef.type === 'oauth2') return AuthType.OAUTH;
    }

    return AuthType.NONE;
  }

  private mapPostmanAuth(type: string): AuthType {
    switch (type.toLowerCase()) {
      case 'bearer': return AuthType.BEARER;
      case 'basic': return AuthType.BASIC;
      case 'apikey': return AuthType.API_KEY;
      case 'oauth2': return AuthType.OAUTH;
      default: return AuthType.NONE;
    }
  }

  private parseMethod(methodRaw: string): HttpMethod | undefined {
    const upper = methodRaw.toUpperCase();
    if (Object.values(HttpMethod).includes(upper as HttpMethod)) {
      return upper as HttpMethod;
    }
    return undefined;
  }

  private normalizeUrl(baseUrl: string, path: string): string {
    const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${cleanBase}${cleanPath}`;
  }

  private extractRequiredHeaders(parameters?: any[]): Record<string, string> {
    const hdrs: Record<string, string> = {};
    if (!parameters || !Array.isArray(parameters)) return hdrs;
    
    for (const p of parameters) {
      if (p.in === 'header' && p.required) {
        // Just supply a dummy value for required headers; strategy or AI generation will override
        hdrs[p.name] = 'REQUIRED_HEADER';
      }
    }
    return hdrs;
  }
}
