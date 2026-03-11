/**
 * Unit tests for database detection in RepositoryContextBuilder
 * Task 3.1: Add database detection to RepositoryContextBuilder
 */

import { describe, it, expect } from 'vitest';
import { RepositoryContextBuilder } from '../src/api-testing/context-retrieval/RepositoryContextBuilder.js';
import { DatabaseType } from '../src/api-testing/models/enums.js';
import type { FileContent } from '../src/api-testing/models/types.js';

describe('RepositoryContextBuilder - Database Detection', () => {
    describe('detectDatabaseDependencies', () => {
        it('should detect MongoDB from mongoose dependency', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'package.json',
                    content: JSON.stringify({
                        dependencies: {
                            mongoose: '^7.0.0',
                            express: '^4.18.0'
                        }
                    }),
                    size: 100
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toContain(DatabaseType.MONGODB);
            expect(result).toHaveLength(1);
        });

        it('should detect PostgreSQL from pg dependency', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'package.json',
                    content: JSON.stringify({
                        dependencies: {
                            pg: '^8.11.0',
                            express: '^4.18.0'
                        }
                    }),
                    size: 100
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toContain(DatabaseType.POSTGRESQL);
            expect(result).toHaveLength(1);
        });

        it('should detect MySQL from mysql2 dependency', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'package.json',
                    content: JSON.stringify({
                        devDependencies: {
                            mysql2: '^3.0.0'
                        }
                    }),
                    size: 100
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toContain(DatabaseType.MYSQL);
            expect(result).toHaveLength(1);
        });

        it('should detect Redis from ioredis dependency', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'package.json',
                    content: JSON.stringify({
                        dependencies: {
                            ioredis: '^5.0.0'
                        }
                    }),
                    size: 100
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toContain(DatabaseType.REDIS);
            expect(result).toHaveLength(1);
        });

        it('should detect SQLite from sqlite3 dependency', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'package.json',
                    content: JSON.stringify({
                        dependencies: {
                            sqlite3: '^5.1.0'
                        }
                    }),
                    size: 100
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toContain(DatabaseType.SQLITE);
            expect(result).toHaveLength(1);
        });

        it('should detect multiple databases', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'package.json',
                    content: JSON.stringify({
                        dependencies: {
                            mongoose: '^7.0.0',
                            redis: '^4.0.0'
                        }
                    }),
                    size: 100
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toContain(DatabaseType.MONGODB);
            expect(result).toContain(DatabaseType.REDIS);
            expect(result).toHaveLength(2);
        });

        it('should return empty array when no database dependencies found', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'package.json',
                    content: JSON.stringify({
                        dependencies: {
                            express: '^4.18.0',
                            lodash: '^4.17.0'
                        }
                    }),
                    size: 100
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toEqual([]);
        });

        it('should detect MongoDB from pymongo in requirements.txt', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'requirements.txt',
                    content: 'pymongo==4.5.0\nfastapi==0.104.0\n',
                    size: 50
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toContain(DatabaseType.MONGODB);
            expect(result).toHaveLength(1);
        });

        it('should detect PostgreSQL from psycopg2 in requirements.txt', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'requirements.txt',
                    content: 'psycopg2-binary>=2.9.0\ndjango==4.2.0\n',
                    size: 50
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toContain(DatabaseType.POSTGRESQL);
            expect(result).toHaveLength(1);
        });

        it('should detect MySQL from mysql-connector-python in requirements.txt', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'requirements.txt',
                    content: 'mysql-connector-python==8.1.0\n',
                    size: 50
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toContain(DatabaseType.MYSQL);
            expect(result).toHaveLength(1);
        });

        it('should handle malformed package.json gracefully', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'package.json',
                    content: 'invalid json {',
                    size: 20
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toEqual([]);
        });

        it('should handle empty config files array', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toEqual([]);
        });

        it('should detect databases from both package.json and requirements.txt', () => {
            const builder = new RepositoryContextBuilder();
            const configFiles: FileContent[] = [
                {
                    path: 'package.json',
                    content: JSON.stringify({
                        dependencies: {
                            redis: '^4.0.0'
                        }
                    }),
                    size: 100
                },
                {
                    path: 'requirements.txt',
                    content: 'pymongo==4.5.0\n',
                    size: 20
                }
            ];

            const result = builder.detectDatabaseDependencies(configFiles);
            
            expect(result).toContain(DatabaseType.MONGODB);
            expect(result).toContain(DatabaseType.REDIS);
            expect(result).toHaveLength(2);
        });
    });
});
