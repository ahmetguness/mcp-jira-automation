/**
 * Database service manager — detects, configures, and starts database services
 * inside Docker containers for sandbox mode testing.
 *
 * Extracted from docker.ts to separate database concerns from container orchestration.
 */

import type Docker from "dockerode";
import { createLogger } from "../logger.js";

const log = createLogger("executor:database");

// ─── Types ───────────────────────────────────────────────────

type ExecInContainerFn = (
    container: Docker.Container,
    cmd: string[],
    workdir?: string,
    customTimeoutMs?: number,
) => Promise<{ exitCode: number; output: string }>;

// ─── Database Package Maps ───────────────────────────────────

const NODE_DATABASE_PACKAGES: Record<string, string> = {
    'mongoose': 'mongodb',
    'mongodb': 'mongodb',
    'pg': 'postgresql',
    'postgres': 'postgresql',
    'mysql': 'mysql',
    'mysql2': 'mysql',
    'redis': 'redis',
    'ioredis': 'redis',
    'sqlite3': 'sqlite',
    'better-sqlite3': 'sqlite',
    'prisma': 'postgresql',
    '@prisma/client': 'postgresql',
};

const NODE_ORM_PACKAGES = ['sequelize', 'typeorm', 'knex', 'drizzle-orm'];

const PYTHON_DATABASE_PACKAGES: Record<string, string> = {
    'pymongo': 'mongodb',
    'motor': 'mongodb',
    'mongoengine': 'mongodb',
    'psycopg2': 'postgresql',
    'psycopg2-binary': 'postgresql',
    'asyncpg': 'postgresql',
    'mysql-connector-python': 'mysql',
    'mysqlclient': 'mysql',
    'PyMySQL': 'mysql',
    'redis': 'redis',
    'aioredis': 'redis',
    'sqlalchemy': 'postgresql',
    'django': 'postgresql',
    'tortoise-orm': 'postgresql',
    'peewee': 'sqlite',
    'databases': 'postgresql',
};

const GO_DATABASE_PACKAGES: Record<string, string> = {
    'github.com/lib/pq': 'postgresql',
    'github.com/jackc/pgx': 'postgresql',
    'gorm.io/driver/postgres': 'postgresql',
    'go.mongodb.org/mongo-driver': 'mongodb',
    'github.com/go-sql-driver/mysql': 'mysql',
    'gorm.io/driver/mysql': 'mysql',
    'github.com/go-redis/redis': 'redis',
    'github.com/redis/go-redis': 'redis',
    'gorm.io/driver/sqlite': 'sqlite',
    'github.com/mattn/go-sqlite3': 'sqlite',
    'gorm.io/gorm': 'postgresql',
};

const JAVA_DATABASE_PATTERNS: Record<string, string> = {
    'postgresql': 'postgresql',
    'mysql-connector': 'mysql',
    'mariadb-java-client': 'mysql',
    'mongodb-driver': 'mongodb',
    'spring-boot-starter-data-mongodb': 'mongodb',
    'spring-boot-starter-data-redis': 'redis',
    'jedis': 'redis',
    'lettuce-core': 'redis',
    'sqlite-jdbc': 'sqlite',
    'h2': 'postgresql',
    'spring-boot-starter-data-jpa': 'postgresql',
};

const RUST_DATABASE_PACKAGES: Record<string, string> = {
    'diesel': 'postgresql',
    'sqlx': 'postgresql',
    'tokio-postgres': 'postgresql',
    'mongodb': 'mongodb',
    'redis': 'redis',
    'rusqlite': 'sqlite',
};

// ─── Database Config ─────────────────────────────────────────

const DATABASE_CONFIG: Record<string, { envVarName: string; testUrl: string }> = {
    'mongodb': { envVarName: 'MONGODB_URL', testUrl: 'mongodb://localhost:27017/test' },
    'postgresql': { envVarName: 'DATABASE_URL', testUrl: 'postgresql://postgres:postgres@localhost:5432/test' },
    'mysql': { envVarName: 'MYSQL_URL', testUrl: 'mysql://root:root@localhost:3306/test' },
    'redis': { envVarName: 'REDIS_URL', testUrl: 'redis://localhost:6379' },
    'sqlite': { envVarName: 'SQLITE_DATABASE', testUrl: ':memory:' },
};

// ─── Public API ──────────────────────────────────────────────

/**
 * Detect database dependencies from package.json, requirements.txt, go.mod, etc.
 * Returns array of detected database types.
 */
export async function detectDatabaseDependencies(
    execInContainer: ExecInContainerFn,
    container: Docker.Container,
    language: string,
): Promise<string[]> {
    const detected: Set<string> = new Set();

    try {
        if (language === 'node') {
            await detectNodeDatabases(execInContainer, container, detected);
        } else if (language === 'python') {
            await detectPythonDatabases(execInContainer, container, detected);
        } else if (language === 'go') {
            await detectGoDatabases(execInContainer, container, detected);
        } else if (language === 'java') {
            await detectJavaDatabases(execInContainer, container, detected);
        } else if (language === 'rust') {
            await detectRustDatabases(execInContainer, container, detected);
        }
    } catch (error) {
        log.warn('Failed to detect database dependencies', { error: String(error) });
    }

    return Array.from(detected);
}

/**
 * Generate environment variables for detected databases.
 */
export function generateDatabaseEnvironmentVariables(detectedDatabases: string[]): string[] {
    const envVars: string[] = [];
    for (const dbType of detectedDatabases) {
        const config = DATABASE_CONFIG[dbType];
        if (config) {
            envVars.push(`${config.envVarName}=${config.testUrl}`);
        }
    }
    return envVars;
}

/**
 * Start database services inside the container.
 */
export async function startDatabaseServices(
    execInContainer: ExecInContainerFn,
    container: Docker.Container,
    detectedDatabases: string[],
    workdir: string,
): Promise<void> {
    for (const dbType of detectedDatabases) {
        try {
            switch (dbType) {
                case 'postgresql':
                    await startPostgreSQL(execInContainer, container, workdir);
                    break;
                case 'mongodb':
                    await startMongoDB(execInContainer, container, workdir);
                    break;
                case 'mysql':
                    await startMySQL(execInContainer, container, workdir);
                    break;
                case 'redis':
                    await startRedis(execInContainer, container, workdir);
                    break;
                case 'sqlite':
                    log.info('SQLite detected — no service to start (file-based)');
                    break;
                default:
                    log.warn(`Unknown database type: ${dbType} — skipping`);
            }
        } catch (error) {
            log.warn(`Failed to start ${dbType} service: ${(error as Error).message}`);
        }
    }

    // Run ORM migrations/schema sync after all databases are up
    await runOrmSetup(execInContainer, container, workdir);
}

// ─── Detection Helpers ───────────────────────────────────────

async function detectNodeDatabases(
    execInContainer: ExecInContainerFn,
    container: Docker.Container,
    detected: Set<string>,
): Promise<void> {
    const packageJsonPaths = [
        '/workspace/package.json',
        '/workspace/backend/package.json',
        '/workspace/server/package.json',
        '/workspace/api/package.json',
    ];

    for (const pkgPath of packageJsonPaths) {
        const result = await execInContainer(container, ['cat', pkgPath]);
        if (result.exitCode === 0 && result.output.trim()) {
            try {
                const pkg = JSON.parse(result.output);
                const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

                for (const [packageName, dbType] of Object.entries(NODE_DATABASE_PACKAGES)) {
                    if (allDeps[packageName]) {
                        detected.add(dbType);
                        log.debug(`Detected ${dbType} dependency: ${packageName} (from ${pkgPath})`);
                    }
                }

                for (const ormPkg of NODE_ORM_PACKAGES) {
                    if (allDeps[ormPkg] && detected.size === 0) {
                        detected.add('postgresql');
                        log.debug(`ORM ${ormPkg} detected without specific driver, defaulting to postgresql (from ${pkgPath})`);
                    }
                }
            } catch (error) {
                log.warn(`Failed to parse ${pkgPath}`, { error: String(error) });
            }
        }
    }
}

async function detectPythonDatabases(
    execInContainer: ExecInContainerFn,
    container: Docker.Container,
    detected: Set<string>,
): Promise<void> {
    const result = await execInContainer(container, ['cat', '/workspace/requirements.txt']);
    if (result.exitCode === 0 && result.output.trim()) {
        const content = result.output;
        for (const [packageName, dbType] of Object.entries(PYTHON_DATABASE_PACKAGES)) {
            const regex = new RegExp(`(^|\\s)${packageName}([=<>!]|$)`, 'm');
            if (regex.test(content)) {
                detected.add(dbType);
                log.debug(`Detected ${dbType} dependency: ${packageName}`);
            }
        }
    }
}

async function detectGoDatabases(
    execInContainer: ExecInContainerFn,
    container: Docker.Container,
    detected: Set<string>,
): Promise<void> {
    const result = await execInContainer(container, ['cat', '/workspace/go.mod']);
    if (result.exitCode === 0 && result.output.trim()) {
        const content = result.output;
        for (const [pkg, dbType] of Object.entries(GO_DATABASE_PACKAGES)) {
            if (content.includes(pkg)) {
                detected.add(dbType);
                log.debug(`Detected ${dbType} dependency: ${pkg} (go.mod)`);
            }
        }
    }
}

async function detectJavaDatabases(
    execInContainer: ExecInContainerFn,
    container: Docker.Container,
    detected: Set<string>,
): Promise<void> {
    for (const configFile of ['/workspace/pom.xml', '/workspace/build.gradle', '/workspace/build.gradle.kts']) {
        const result = await execInContainer(container, ['cat', configFile]);
        if (result.exitCode === 0 && result.output.trim()) {
            const content = result.output;
            for (const [pattern, dbType] of Object.entries(JAVA_DATABASE_PATTERNS)) {
                if (content.includes(pattern)) {
                    detected.add(dbType);
                    log.debug(`Detected ${dbType} dependency: ${pattern} (${configFile})`);
                }
            }
        }
    }
}

async function detectRustDatabases(
    execInContainer: ExecInContainerFn,
    container: Docker.Container,
    detected: Set<string>,
): Promise<void> {
    const result = await execInContainer(container, ['cat', '/workspace/Cargo.toml']);
    if (result.exitCode === 0 && result.output.trim()) {
        const content = result.output;
        for (const [pkg, dbType] of Object.entries(RUST_DATABASE_PACKAGES)) {
            if (content.includes(`${pkg} `) || content.includes(`${pkg}=`) || content.includes(`"${pkg}"`)) {
                detected.add(dbType);
                log.debug(`Detected ${dbType} dependency: ${pkg} (Cargo.toml)`);
            }
        }
    }
}

// ─── Service Starters ────────────────────────────────────────

async function startPostgreSQL(execInContainer: ExecInContainerFn, container: Docker.Container, workdir: string): Promise<void> {
    const result = await execInContainer(
        container,
        ['sh', '-c', [
            'apt-get update -qq',
            'apt-get install -y -qq postgresql postgresql-client > /dev/null 2>&1',
            'mkdir -p /run/postgresql && chown postgres:postgres /run/postgresql',
            'su postgres -c "pg_ctlcluster 15 main start" 2>/dev/null || su postgres -c "/usr/lib/postgresql/*/bin/pg_ctl -D /var/lib/postgresql/*/main start -l /tmp/pg.log"',
            'for i in $(seq 1 10); do su postgres -c "pg_isready" && break || sleep 1; done',
            'su postgres -c "psql -c \\"CREATE DATABASE test;\\" 2>/dev/null || true"',
            'su postgres -c "psql -c \\"ALTER USER postgres PASSWORD \'postgres\';\\" 2>/dev/null || true"',
            'echo "PostgreSQL started successfully"',
        ].join(' && ')],
        workdir,
        120000,
    );
    logDbResult(result, 'PostgreSQL');
}

async function startMongoDB(execInContainer: ExecInContainerFn, container: Docker.Container, workdir: string): Promise<void> {
    const result = await execInContainer(
        container,
        ['sh', '-c', [
            'apt-get update -qq',
            'apt-get install -y -qq gnupg curl > /dev/null 2>&1',
            'curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg',
            'echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb-org-7.0.list',
            'apt-get update -qq',
            'apt-get install -y -qq mongodb-org > /dev/null 2>&1',
            'mkdir -p /data/db /var/log/mongodb',
            'mongod --dbpath /data/db --logpath /var/log/mongodb/mongod.log --fork --bind_ip 127.0.0.1',
            'for i in $(seq 1 15); do mongosh --eval "db.runCommand({ping:1})" --quiet > /dev/null 2>&1 && break || sleep 1; done',
            'echo "MongoDB started successfully"',
        ].join(' && ')],
        workdir,
        180000,
    );
    logDbResult(result, 'MongoDB');
}

async function startMySQL(execInContainer: ExecInContainerFn, container: Docker.Container, workdir: string): Promise<void> {
    const result = await execInContainer(
        container,
        ['sh', '-c', [
            'apt-get update -qq',
            'apt-get install -y -qq mariadb-server mariadb-client > /dev/null 2>&1',
            'mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld',
            'mysqld_safe --skip-grant-tables &',
            'for i in $(seq 1 15); do mysqladmin ping --silent 2>/dev/null && break || sleep 1; done',
            'mysql -e "CREATE DATABASE IF NOT EXISTS test;" 2>/dev/null || true',
            'mysql -e "ALTER USER \'root\'@\'localhost\' IDENTIFIED BY \'root\'; FLUSH PRIVILEGES;" 2>/dev/null || true',
            'echo "MySQL (MariaDB) started successfully"',
        ].join(' && ')],
        workdir,
        120000,
    );
    logDbResult(result, 'MySQL');
}

async function startRedis(execInContainer: ExecInContainerFn, container: Docker.Container, workdir: string): Promise<void> {
    const result = await execInContainer(
        container,
        ['sh', '-c', [
            'apt-get update -qq',
            'apt-get install -y -qq redis-server > /dev/null 2>&1',
            'redis-server --daemonize yes',
            'for i in $(seq 1 5); do redis-cli ping 2>/dev/null | grep -q PONG && break || sleep 1; done',
            'echo "Redis started successfully"',
        ].join(' && ')],
        workdir,
        60000,
    );
    logDbResult(result, 'Redis');
}

// ─── ORM Setup ───────────────────────────────────────────────

async function runOrmSetup(execInContainer: ExecInContainerFn, container: Docker.Container, workdir: string): Promise<void> {
    const ormCheck = await execInContainer(
        container,
        ['sh', '-c', [
            'echo "---PRISMA---"',
            'test -f node_modules/.bin/prisma && echo "yes" || echo "no"',
            'echo "---TYPEORM---"',
            'test -f node_modules/.bin/typeorm && echo "yes" || echo "no"',
            'echo "---SEQUELIZE---"',
            'test -f node_modules/.bin/sequelize && echo "yes" || echo "no"',
            'echo "---KNEX---"',
            'test -f node_modules/.bin/knex && echo "yes" || echo "no"',
            'echo "---DRIZZLE---"',
            'test -f node_modules/.bin/drizzle-kit && echo "yes" || echo "no"',
            'echo "---MONGOOSE---"',
            'test -d node_modules/mongoose && echo "yes" || echo "no"',
        ].join(' && ')],
        workdir,
        5000,
    );

    const output = ormCheck.output;
    const hasOrm = (marker: string) => {
        const idx = output.indexOf(marker);
        if (idx === -1) return false;
        const after = output.slice(idx + marker.length).trim();
        return after.startsWith('yes');
    };

    if (hasOrm('---PRISMA---')) {
        log.info('Running Prisma setup...');
        const schemaCheck = await execInContainer(
            container,
            ['sh', '-c', 'cat prisma/schema.prisma 2>/dev/null || cat schema.prisma 2>/dev/null || echo ""'],
            workdir,
            5000,
        );
        const schemaContent = schemaCheck.output;
        let prismaProvider = 'postgresql';
        if (schemaContent.includes('provider = "mysql"') || schemaContent.includes("provider = 'mysql'")) {
            prismaProvider = 'mysql';
        } else if (schemaContent.includes('provider = "mongodb"') || schemaContent.includes("provider = 'mongodb'")) {
            prismaProvider = 'mongodb';
        } else if (schemaContent.includes('provider = "sqlite"') || schemaContent.includes("provider = 'sqlite'")) {
            prismaProvider = 'sqlite';
        }
        log.debug(`Prisma provider: ${prismaProvider}`);

        const result = await execInContainer(
            container,
            ['sh', '-c', 'npx prisma generate 2>&1 && npx prisma db push --skip-generate --accept-data-loss 2>&1'],
            workdir,
            60000,
        );
        if (result.exitCode === 0) {
            log.info('✅ Prisma schema pushed');
        } else {
            log.warn(`Prisma setup failed: ${result.output.slice(0, 200)}`);
        }
    }

    if (hasOrm('---TYPEORM---')) {
        log.info('Running TypeORM schema sync...');
        const result = await execInContainer(
            container,
            ['sh', '-c', 'npx typeorm schema:sync 2>&1 || npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js schema:sync 2>&1'],
            workdir,
            60000,
        );
        if (result.exitCode === 0) { log.info('✅ TypeORM synced'); }
        else { log.warn(`TypeORM sync failed: ${result.output.slice(0, 200)}`); }
    }

    if (hasOrm('---SEQUELIZE---')) {
        log.info('Running Sequelize migrations...');
        const result = await execInContainer(
            container,
            ['sh', '-c', 'npx sequelize-cli db:migrate 2>&1 || echo "Sequelize migration skipped"'],
            workdir,
            60000,
        );
        if (result.exitCode === 0) { log.info('✅ Sequelize migrations done'); }
        else { log.warn(`Sequelize migration failed: ${result.output.slice(0, 200)}`); }
    }

    if (hasOrm('---KNEX---')) {
        log.info('Running Knex migrations...');
        const result = await execInContainer(
            container,
            ['sh', '-c', 'npx knex migrate:latest 2>&1 || echo "Knex migration skipped"'],
            workdir,
            60000,
        );
        if (result.exitCode === 0) { log.info('✅ Knex migrations done'); }
        else { log.warn(`Knex migration failed: ${result.output.slice(0, 200)}`); }
    }

    if (hasOrm('---DRIZZLE---')) {
        log.info('Running Drizzle push...');
        const result = await execInContainer(
            container,
            ['sh', '-c', 'npx drizzle-kit push 2>&1 || echo "Drizzle push skipped"'],
            workdir,
            60000,
        );
        if (result.exitCode === 0) { log.info('✅ Drizzle schema pushed'); }
        else { log.warn(`Drizzle push failed: ${result.output.slice(0, 200)}`); }
    }

    if (hasOrm('---MONGOOSE---')) {
        log.debug('Mongoose detected — no migration needed');
    }

    // Run seed scripts if available
    await runSeedScripts(execInContainer, container, workdir);
}

async function runSeedScripts(execInContainer: ExecInContainerFn, container: Docker.Container, workdir: string): Promise<void> {
    const seedCheck = await execInContainer(
        container,
        ['sh', '-c', [
            'echo "---PKG_SEED---"',
            'cat package.json 2>/dev/null | grep -q \'"seed"\' && echo "yes" || echo "no"',
            'echo "---PRISMA_SEED---"',
            'cat prisma/schema.prisma 2>/dev/null | grep -q "seed" && echo "yes" || (cat package.json 2>/dev/null | grep -q \'"prisma".*"seed"\' && echo "yes" || echo "no")',
            'echo "---DJANGO_MANAGE---"',
            'test -f manage.py && echo "yes" || echo "no"',
            'echo "---SEEDERS_DIR---"',
            'test -d seeders && echo "yes" || (test -d src/seeders && echo "yes" || echo "no")',
        ].join(' && ')],
        workdir,
        5000,
    );

    const seedOutput = seedCheck.output;
    const hasSeed = (marker: string) => {
        const idx = seedOutput.indexOf(marker);
        if (idx === -1) return false;
        const after = seedOutput.slice(idx + marker.length).trim();
        return after.startsWith('yes');
    };

    if (hasSeed('---PKG_SEED---')) {
        log.info('🌱 Running npm seed script...');
        const result = await execInContainer(container, ['sh', '-c', 'npm run seed 2>&1 || echo "Seed script failed (non-fatal)"'], workdir, 60000);
        if (result.exitCode === 0) { log.info('✅ Seed script completed'); }
        else { log.debug(`Seed script exited with code ${result.exitCode} (non-fatal)`); }
    } else if (hasSeed('---PRISMA_SEED---')) {
        log.info('🌱 Running Prisma seed...');
        const result = await execInContainer(container, ['sh', '-c', 'npx prisma db seed 2>&1 || echo "Prisma seed failed (non-fatal)"'], workdir, 60000);
        if (result.exitCode === 0) { log.info('✅ Prisma seed completed'); }
        else { log.debug(`Prisma seed exited with code ${result.exitCode} (non-fatal)`); }
    }

    if (hasSeed('---DJANGO_MANAGE---')) {
        log.info('🌱 Running Django seed...');
        await execInContainer(
            container,
            ['sh', '-c', 'python manage.py migrate 2>&1 && (python manage.py loaddata initial_data 2>&1 || python manage.py seed 2>&1 || true)'],
            workdir,
            60000,
        );
    }
}

function logDbResult(result: { exitCode: number; output: string }, name: string): void {
    if (result.exitCode === 0) {
        log.info(`${name} service started successfully`);
    } else {
        log.warn(`${name} setup exited with code ${result.exitCode}: ${result.output.slice(0, 300)}`);
    }
}
