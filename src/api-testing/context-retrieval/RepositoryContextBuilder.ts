/**
 * RepositoryContextBuilder class - Retrieves ONLY test-relevant files from repository
 * Feature: api-endpoint-testing-transformation
 * Requirements: 11.2
 * 
 * This module retrieves ONLY test-relevant files from the repository to minimize
 * token usage and improve AI accuracy. It intelligently selects files based on
 * the task mode (full API or specific endpoint).
 * 
 * CRITICAL - Context-Aware Retrieval:
 * The system supports TWO modes based on task description:
 * 1. Full API Mode: Retrieve broader context (all API specs, all tests, all docs)
 * 2. Specific Endpoint Mode: Retrieve ONLY files related to the specific endpoint
 * 
 * Files to RETRIEVE:
 * - API specifications: openapi.yaml, swagger.json, *.postman_collection.json
 * - Existing tests: tests/api/**, __tests__/api/**, test/api/**
 * - Documentation: README.md, docs/api/**, API.md, AUTHENTICATION.md
 * - Configuration: package.json, requirements.txt, pytest.ini, .env.example
 * 
 * Files to NEVER RETRIEVE:
 * - Source code files (.js, .py, .java in src/, lib/, app/)
 * - Build artifacts
 * - Dependencies (node_modules/, venv/)
 * - Large binary files
 */

import type {
  RepositoryInfo,
  TestContext,
  FileContent,
  EndpointSpec,
} from '../models/types.js';
import { TestFramework, DatabaseType } from '../models/enums.js';
import { createLogger } from '../../logger.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const log = createLogger('api-testing:context-retrieval');

/**
 * Configuration for RepositoryContextBuilder
 */
export interface RepositoryContextBuilderConfig {
  /** Maximum file size to retrieve (in bytes, default: 1MB) */
  maxFileSizeBytes?: number;
  /** Maximum total context size (in bytes, default: 10MB) */
  maxTotalContextBytes?: number;
  /** Local repository path (if already cloned) */
  localRepoPath?: string;
}

/**
 * RepositoryContextBuilder - Retrieves minimal context needed for test generation
 * 
 * This class retrieves ONLY test-relevant files from the repository, never
 * source code files. It supports two modes:
 * 1. Full API Mode: Retrieve all API specs, tests, and docs
 * 2. Specific Endpoint Mode: Filter files related to specific endpoints
 */
export class RepositoryContextBuilder {
  private config: RepositoryContextBuilderConfig;

  constructor(config: RepositoryContextBuilderConfig = {}) {
    this.config = {
      maxFileSizeBytes: 1024 * 1024, // 1MB
      maxTotalContextBytes: 10 * 1024 * 1024, // 10MB
      ...config,
    };

    log.info('RepositoryContextBuilder initialized', {
      maxFileSizeBytes: this.config.maxFileSizeBytes,
      maxTotalContextBytes: this.config.maxTotalContextBytes,
    });
  }

  /**
   * Retrieve minimal context needed for test generation
   * Requirements: 11.2
   * 
   * This is the main method that orchestrates the retrieval of all test-relevant
   * files from the repository. It NEVER retrieves source code files.
   * 
   * @param repo - Repository information
   * @param endpointSpecs - Endpoint specifications (used for context-aware filtering)
   * @returns TestContext with all retrieved files and detected framework
   */
  async retrieveContext(
    repo: RepositoryInfo,
    endpointSpecs: EndpointSpec[]
  ): Promise<TestContext> {
    log.info(`Retrieving context from repository`, {
      repoUrl: repo.url,
      endpointCount: endpointSpecs.length,
    });

    const repoPath = this.config.localRepoPath ?? this.getRepositoryPath(repo);
    
    // Retrieve different categories of files
    const [apiSpecs, existingTests, documentation, configFiles] = await Promise.all([
      this.findApiSpecs(repo, repoPath),
      this.findExistingTests(repo, repoPath),
      this.findDocumentation(repo, repoPath),
      this.findConfigurationFiles(repo, repoPath),
    ]);

    // Detect test framework from configuration files
    const detectedFramework = this.detectTestFramework(repo, configFiles);

    // Detect database dependencies from configuration files
    const detectedDatabases = this.detectDatabaseDependencies(configFiles);

    // Calculate total context size
    const totalSize = this.calculateTotalSize([
      ...apiSpecs,
      ...existingTests,
      ...documentation,
      ...configFiles,
    ]);

    log.info('Context retrieval complete', {
      apiSpecsCount: apiSpecs.length,
      existingTestsCount: existingTests.length,
      documentationCount: documentation.length,
      configFilesCount: configFiles.length,
      detectedFramework,
      detectedDatabases,
      totalSizeBytes: totalSize,
    });

    // Warn if context size is too large
    if (totalSize > this.config.maxTotalContextBytes!) {
      log.warn('Total context size exceeds maximum', {
        totalSize,
        maxSize: this.config.maxTotalContextBytes,
      });
    }

    return {
      apiSpecifications: apiSpecs,
      existingTests,
      documentation,
      configurationFiles: configFiles,
      detectedFramework,
      detectedDatabases,
      repositoryInfo: repo,
    };
  }

  /**
   * Find OpenAPI, Swagger, and Postman collection files
   * Requirements: 11.2
   * 
   * Searches for API specification files in common locations:
   * - openapi.yaml, openapi.yml, openapi.json
   * - swagger.yaml, swagger.yml, swagger.json
   * - *.postman_collection.json
   * - api-spec.yaml, api-spec.json
   * - docs/openapi.*, docs/swagger.*
   * 
   * @param repo - Repository information
   * @param repoPath - Local path to repository
   * @returns Array of API specification files
   */
  async findApiSpecs(repo: RepositoryInfo, repoPath?: string): Promise<FileContent[]> {
    log.debug('Finding API specification files');

    const path = repoPath ?? this.getRepositoryPath(repo);
    const apiSpecs: FileContent[] = [];

    // Common API spec file patterns
    const patterns = [
      'openapi.yaml',
      'openapi.yml',
      'openapi.json',
      'swagger.yaml',
      'swagger.yml',
      'swagger.json',
      'api-spec.yaml',
      'api-spec.yml',
      'api-spec.json',
      'docs/openapi.*',
      'docs/swagger.*',
      'docs/api-spec.*',
      '*.postman_collection.json',
      'postman/*.json',
    ];

    for (const pattern of patterns) {
      const files = await this.findFilesByPattern(path, pattern);
      for (const file of files) {
        const content = await this.readFileIfValid(file);
        if (content) {
          apiSpecs.push(content);
        }
      }
    }

    log.debug(`Found ${apiSpecs.length} API specification files`);
    return apiSpecs;
  }

  /**
   * Find existing API tests for reference
   * Requirements: 11.2
   * 
   * Searches for existing test files in common test directories:
   * - tests/api/**
   * - __tests__/api/**
   * - test/api/**
   * - spec/api/**
   * 
   * NEVER retrieves source code files, only test files.
   * 
   * @param repo - Repository information
   * @param repoPath - Local path to repository
   * @returns Array of existing test files
   */
  async findExistingTests(repo: RepositoryInfo, repoPath?: string): Promise<FileContent[]> {
    log.debug('Finding existing test files');

    const path = repoPath ?? this.getRepositoryPath(repo);
    const testFiles: FileContent[] = [];

    // Common test directory patterns
    const testDirs = [
      'tests/api',
      '__tests__/api',
      'test/api',
      'spec/api',
    ];

    for (const testDir of testDirs) {
      const dirPath = this.joinPath(path, testDir);
      const exists = await this.directoryExists(dirPath);
      
      if (exists) {
        const files = await this.findTestFilesInDirectory(dirPath);
        for (const file of files) {
          const content = await this.readFileIfValid(file);
          if (content) {
            testFiles.push(content);
          }
        }
      }
    }

    log.debug(`Found ${testFiles.length} existing test files`);
    return testFiles;
  }

  /**
   * Find README and API documentation files
   * Requirements: 11.2
   * 
   * Searches for documentation files:
   * - README.md
   * - docs/api/**
   * - API.md
   * - AUTHENTICATION.md
   * - docs/authentication.*
   * - docs/README.md
   * 
   * @param repo - Repository information
   * @param repoPath - Local path to repository
   * @returns Array of documentation files
   */
  async findDocumentation(repo: RepositoryInfo, repoPath?: string): Promise<FileContent[]> {
    log.debug('Finding documentation files');

    const path = repoPath ?? this.getRepositoryPath(repo);
    const docFiles: FileContent[] = [];

    // Common documentation file patterns
    const patterns = [
      'README.md',
      'API.md',
      'AUTHENTICATION.md',
      'docs/README.md',
      'docs/api/**/*.md',
      'docs/authentication.*',
    ];

    for (const pattern of patterns) {
      const files = await this.findFilesByPattern(path, pattern);
      for (const file of files) {
        const content = await this.readFileIfValid(file);
        if (content) {
          docFiles.push(content);
        }
      }
    }

    log.debug(`Found ${docFiles.length} documentation files`);
    return docFiles;
  }

  /**
   * Find configuration files (package.json, requirements.txt, etc.)
   * Requirements: 11.2
   * 
   * Searches for configuration files needed for framework detection:
   * - package.json
   * - requirements.txt
   * - pytest.ini
   * - .env.example
   * - jest.config.js
   * - vitest.config.ts
   * 
   * @param repo - Repository information
   * @param repoPath - Local path to repository
   * @returns Array of configuration files
   */
  private async findConfigurationFiles(
    repo: RepositoryInfo,
    repoPath: string
  ): Promise<FileContent[]> {
    log.debug('Finding configuration files');

    const configFiles: FileContent[] = [];

    // Common configuration file patterns
    const patterns = [
      'package.json',
      'requirements.txt',
      'pytest.ini',
      '.env.example',
      'jest.config.js',
      'jest.config.ts',
      'vitest.config.js',
      'vitest.config.ts',
      'pyproject.toml',
    ];

    for (const pattern of patterns) {
      const files = await this.findFilesByPattern(repoPath, pattern);
      for (const file of files) {
        const content = await this.readFileIfValid(file);
        if (content) {
          configFiles.push(content);
        }
      }
    }

    log.debug(`Found ${configFiles.length} configuration files`);
    return configFiles;
  }

  /**
   * Detect test framework from package files
   * Requirements: 11.2
   * 
   * Analyzes configuration files to detect the test framework:
   * - Jest/Supertest: package.json with jest + supertest
   * - Pytest: requirements.txt with pytest + requests
   * - Postman: *.postman_collection.json files
   * 
   * @param repo - Repository information
   * @param configFiles - Configuration files to analyze
   * @returns Detected TestFramework or undefined
   */
  detectTestFramework(
    repo: RepositoryInfo,
    configFiles: FileContent[]
  ): TestFramework | undefined {
    log.debug('Detecting test framework from configuration files');

    // Check for Node.js frameworks (Jest, Vitest)
    const packageJson = configFiles.find(f => f.path.endsWith('package.json'));
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson.content);
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };

        // Check for Jest + Supertest
        if (allDeps.jest && allDeps.supertest) {
          log.info('Detected test framework: Jest + Supertest');
          return TestFramework.JEST_SUPERTEST;
        }
      } catch (error) {
        log.warn('Failed to parse package.json', { error });
      }
    }

    // Check for Python frameworks (Pytest)
    const requirementsTxt = configFiles.find(f => f.path.endsWith('requirements.txt'));
    const pytestIni = configFiles.find(f => f.path.endsWith('pytest.ini'));
    const pyprojectToml = configFiles.find(f => f.path.endsWith('pyproject.toml'));

    if (requirementsTxt || pytestIni || pyprojectToml) {
      const content = requirementsTxt?.content ?? pytestIni?.content ?? pyprojectToml?.content ?? '';
      
      // Check for pytest + requests
      if (content.includes('pytest') && content.includes('requests')) {
        log.info('Detected test framework: Pytest + Requests');
        return TestFramework.PYTEST_REQUESTS;
      }

      // Check for pytest + httpx
      if (content.includes('pytest') && content.includes('httpx')) {
        log.info('Detected test framework: Pytest + HTTPX');
        return TestFramework.PYTEST_HTTPX;
      }
    }

    log.debug('No test framework detected');
    return undefined;
  }
  /**
   * Detect database dependencies from configuration files
   * Requirements: 2.1, 2.2, 3.1
   *
   * Analyzes package.json and requirements.txt to detect database dependencies.
   * This is used to determine if test database configuration should be provided.
   *
   * @param configFiles - Configuration files from repository
   * @returns Array of detected database types
   */
  detectDatabaseDependencies(configFiles: FileContent[]): DatabaseType[] {
    log.debug('Detecting database dependencies from configuration files');

    const detectedDatabases: Set<DatabaseType> = new Set();

    // Node.js database packages mapping
    const nodeDatabasePackages: Record<string, DatabaseType> = {
      'mongoose': DatabaseType.MONGODB,
      'mongodb': DatabaseType.MONGODB,
      'pg': DatabaseType.POSTGRESQL,
      'postgres': DatabaseType.POSTGRESQL,
      'mysql': DatabaseType.MYSQL,
      'mysql2': DatabaseType.MYSQL,
      'redis': DatabaseType.REDIS,
      'ioredis': DatabaseType.REDIS,
      'sqlite3': DatabaseType.SQLITE,
      'better-sqlite3': DatabaseType.SQLITE,
      'sequelize': DatabaseType.POSTGRESQL, // Sequelize supports multiple, default to PostgreSQL
      'typeorm': DatabaseType.POSTGRESQL, // TypeORM supports multiple, default to PostgreSQL
      'prisma': DatabaseType.POSTGRESQL, // Prisma supports multiple, default to PostgreSQL
      'knex': DatabaseType.POSTGRESQL, // Knex supports multiple, default to PostgreSQL
    };

    // Python database packages mapping
    const pythonDatabasePackages: Record<string, DatabaseType> = {
      'pymongo': DatabaseType.MONGODB,
      'psycopg2': DatabaseType.POSTGRESQL,
      'psycopg2-binary': DatabaseType.POSTGRESQL,
      'mysql-connector-python': DatabaseType.MYSQL,
      'redis': DatabaseType.REDIS,
      'sqlalchemy': DatabaseType.POSTGRESQL, // SQLAlchemy supports multiple, default to PostgreSQL
      'django': DatabaseType.POSTGRESQL, // Django supports multiple, default to PostgreSQL
    };

    // Check package.json for Node.js dependencies
    const packageJson = configFiles.find(f => f.path.endsWith('package.json'));
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson.content);
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };

        // Check each dependency against known database packages
        for (const [packageName, dbType] of Object.entries(nodeDatabasePackages)) {
          if (allDeps[packageName]) {
            detectedDatabases.add(dbType);
            log.debug(`Detected ${dbType} dependency: ${packageName}`);
          }
        }
      } catch (error) {
        log.warn('Failed to parse package.json', { error });
      }
    }

    // Check requirements.txt for Python dependencies
    const requirementsTxt = configFiles.find(f => f.path.endsWith('requirements.txt'));
    if (requirementsTxt) {
      const content = requirementsTxt.content;

      // Check each line for known database packages
      for (const [packageName, dbType] of Object.entries(pythonDatabasePackages)) {
        // Match package name at start of line or after whitespace, followed by version specifier or newline
        const regex = new RegExp(`(^|\\s)${packageName}([=<>!]|$)`, 'm');
        if (regex.test(content)) {
          detectedDatabases.add(dbType);
          log.debug(`Detected ${dbType} dependency: ${packageName}`);
        }
      }
    }

    const result = Array.from(detectedDatabases);

    if (result.length > 0) {
      log.info('Database dependencies detected', { databases: result });
    } else {
      log.debug('No database dependencies detected');
    }

    return result;
  }

  /**
   * Get the local path to the repository
   * 
   * @param repo - Repository information
   * @returns Local path to repository
   */
  private getRepositoryPath(repo: RepositoryInfo): string {
    // In a real implementation, this would clone the repository
    // For now, we'll assume the repository is already cloned locally
    // or use the localRepoPath from config
    
    if (this.config.localRepoPath) {
      return this.config.localRepoPath;
    }

    // Extract repository name from URL
    const repoName = repo.url.split('/').pop()?.replace('.git', '') ?? 'repo';
    const tempPath = path.join('/tmp', 'api-testing-repos', repoName);
    
    log.debug('Using repository path', { path: tempPath });
    return tempPath;
  }

  /**
   * Find files matching a pattern in the repository
   * 
   * @param basePath - Base path to search from
   * @param pattern - File pattern to match (supports * wildcard)
   * @returns Array of file paths
   */
  private async findFilesByPattern(basePath: string, pattern: string): Promise<string[]> {
    const files: string[] = [];

    try {
      // Handle simple patterns (no wildcards)
      if (!pattern.includes('*')) {
        const filePath = this.joinPath(basePath, pattern);
        const exists = await this.fileExists(filePath);
        if (exists) {
          files.push(filePath);
        }
        return files;
      }

      // Handle patterns with wildcards
      const parts = pattern.split('/');
      const result = await this.findFilesRecursive(basePath, parts, 0);
      files.push(...result);
    } catch (error) {
      log.debug(`Error finding files for pattern ${pattern}`, { error });
    }

    return files;
  }

  /**
   * Recursively find files matching pattern parts
   * 
   * @param currentPath - Current directory path
   * @param patternParts - Pattern parts to match
   * @param partIndex - Current pattern part index
   * @returns Array of matching file paths
   */
  private async findFilesRecursive(
    currentPath: string,
    patternParts: string[],
    partIndex: number
  ): Promise<string[]> {
    const files: string[] = [];

    if (partIndex >= patternParts.length) {
      return files;
    }

    const currentPart = patternParts[partIndex];
    if (!currentPart) {
      return files;
    }
    
    const isLastPart = partIndex === patternParts.length - 1;

    try {
      const exists = await this.directoryExists(currentPath);
      if (!exists) {
        return files;
      }

      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip excluded directories
        if (entry.isDirectory() && this.isExcludedDirectory(entry.name)) {
          continue;
        }

        const entryPath = this.joinPath(currentPath, entry.name);

        // Handle ** (recursive wildcard)
        if (currentPart === '**') {
          if (entry.isDirectory()) {
            // Continue recursively in subdirectories
            const subFiles = await this.findFilesRecursive(entryPath, patternParts, partIndex);
            files.push(...subFiles);
            
            // Also try matching next pattern part
            if (partIndex + 1 < patternParts.length) {
              const nextFiles = await this.findFilesRecursive(entryPath, patternParts, partIndex + 1);
              files.push(...nextFiles);
            }
          }
          continue;
        }

        // Handle * (single-level wildcard)
        if (currentPart.includes('*')) {
          const regex = this.patternToRegex(currentPart);
          if (regex.test(entry.name)) {
            if (isLastPart && entry.isFile()) {
              files.push(entryPath);
            } else if (!isLastPart && entry.isDirectory()) {
              const subFiles = await this.findFilesRecursive(entryPath, patternParts, partIndex + 1);
              files.push(...subFiles);
            }
          }
          continue;
        }

        // Handle exact match
        if (entry.name === currentPart) {
          if (isLastPart && entry.isFile()) {
            files.push(entryPath);
          } else if (!isLastPart && entry.isDirectory()) {
            const subFiles = await this.findFilesRecursive(entryPath, patternParts, partIndex + 1);
            files.push(...subFiles);
          }
        }
      }
    } catch (error) {
      log.debug(`Error reading directory ${currentPath}`, { error });
    }

    return files;
  }

  /**
   * Find test files in a directory
   * 
   * @param dirPath - Directory path to search
   * @returns Array of test file paths
   */
  private async findTestFilesInDirectory(dirPath: string): Promise<string[]> {
    const testFiles: string[] = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = this.joinPath(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively search subdirectories
          const subFiles = await this.findTestFilesInDirectory(entryPath);
          testFiles.push(...subFiles);
        } else if (entry.isFile() && this.isTestFile(entry.name)) {
          testFiles.push(entryPath);
        }
      }
    } catch (error) {
      log.debug(`Error reading test directory ${dirPath}`, { error });
    }

    return testFiles;
  }

  /**
   * Check if a file is a test file based on naming conventions
   * 
   * @param filename - File name to check
   * @returns true if file is a test file
   */
  private isTestFile(filename: string): boolean {
    const testPatterns = [
      /\.test\.(js|ts|py)$/,
      /\.spec\.(js|ts|py)$/,
      /_test\.py$/,
      /test_.*\.py$/,
    ];

    return testPatterns.some(pattern => pattern.test(filename));
  }

  /**
   * Check if a directory should be excluded from search
   * Requirements: 11.2 (NEVER retrieve source code, dependencies, build artifacts)
   * 
   * @param dirName - Directory name to check
   * @returns true if directory should be excluded
   */
  private isExcludedDirectory(dirName: string): boolean {
    const excludedDirs = [
      'node_modules',
      'venv',
      '.venv',
      'env',
      '.env',
      '__pycache__',
      '.git',
      '.svn',
      'dist',
      'build',
      'target',
      'out',
      '.next',
      '.nuxt',
      'coverage',
      '.pytest_cache',
      '.mypy_cache',
    ];

    return excludedDirs.includes(dirName);
  }

  /**
   * Check if a file should be excluded from retrieval
   * Requirements: 11.2 (NEVER retrieve source code files)
   * 
   * @param filePath - File path to check
   * @returns true if file should be excluded
   */
  private isExcludedFile(filePath: string): boolean {
    // NEVER retrieve source code files from src/, lib/, app/ directories
    const sourceCodeDirs = ['/src/', '/lib/', '/app/', '/server/', '/client/'];
    const isInSourceDir = sourceCodeDirs.some(dir => filePath.includes(dir));
    
    if (isInSourceDir) {
      const ext = path.extname(filePath);
      const sourceCodeExts = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rb', '.php'];
      if (sourceCodeExts.includes(ext)) {
        return true;
      }
    }

    // Exclude binary files
    const binaryExts = ['.exe', '.dll', '.so', '.dylib', '.bin', '.zip', '.tar', '.gz', '.jpg', '.png', '.gif', '.pdf'];
    const ext = path.extname(filePath);
    if (binaryExts.includes(ext)) {
      return true;
    }

    return false;
  }

  /**
   * Read file if it's valid and within size limits
   * 
   * @param filePath - Path to file
   * @returns FileContent if valid, null otherwise
   */
  private async readFileIfValid(filePath: string): Promise<FileContent | null> {
    try {
      // Check if file should be excluded
      if (this.isExcludedFile(filePath)) {
        log.debug(`Skipping excluded file: ${filePath}`);
        return null;
      }

      // Check file size
      const stats = await fs.stat(filePath);
      if (stats.size > this.config.maxFileSizeBytes!) {
        log.debug(`Skipping file (too large): ${filePath}`, {
          size: stats.size,
          maxSize: this.config.maxFileSizeBytes,
        });
        return null;
      }

      // Read file content
      const content = await fs.readFile(filePath, 'utf-8');

      return {
        path: filePath,
        content,
        size: stats.size,
      };
    } catch (error) {
      log.debug(`Error reading file ${filePath}`, { error });
      return null;
    }
  }

  /**
   * Calculate total size of file contents
   * 
   * @param files - Array of file contents
   * @returns Total size in bytes
   */
  private calculateTotalSize(files: FileContent[]): number {
    return files.reduce((total, file) => total + file.size, 0);
  }

  /**
   * Convert glob pattern to regex
   * 
   * @param pattern - Glob pattern
   * @returns Regular expression
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
  }

  /**
   * Check if a file exists
   * 
   * @param filePath - Path to file
   * @returns true if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory exists
   * 
   * @param dirPath - Path to directory
   * @returns true if directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Join path parts (cross-platform)
   * 
   * @param parts - Path parts to join
   * @returns Joined path
   */
  private joinPath(...parts: string[]): string {
    return path.join(...parts);
  }
}
