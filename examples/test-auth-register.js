/**
 * ============================================================================
 * Jira Issue: KAN-37
 * ============================================================================
 * Tests for the auth register route: exercise POST /v1/auth/register to verify
 * successful registration returns 201, validate error handling for bad requests
 * and duplicates, and check response headers and shapes. Also verify that an
 * unknown auth route returns 404.
 *
 * ============================================================================
 * Test Plan:
 * ============================================================================
 * 1. Happy path: POST /v1/auth/register with valid name/email/password
 *    -> expect 201, Content-Type application/json, response body parsed as
 *    object and contains at least one of: id, email, token, user.
 *
 * 2. Invalid request body (missing password): expect 400 and JSON response.
 *
 * 3. Invalid email format: expect 400 and JSON response.
 *
 * 4. Duplicate registration: registering same email twice should succeed first
 *    (201) and return a client error (4xx) on second attempt.
 *
 * 5. Resource not found: GET /v1/auth/nonexistent should return 404.
 *
 * Assertions include status codes, Content-Type header checks, response body
 * type/shape checks, and clear pass/fail reporting.
 * ============================================================================
 */

const http = require('http');
const assert = require('assert');

// ── Configuration ───────────────────────────────────────────────────────────
const BASE_URL = 'http://localhost:3001';
const TIMEOUT_MS = 15000;
let passed = 0;
let failed = 0;

// ── Helper: make HTTP request ───────────────────────────────────────────────
function makeRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsedBody;
        try {
          parsedBody = JSON.parse(data);
        } catch {
          parsedBody = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsedBody,
        });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Helper: test runner ─────────────────────────────────────────────────────
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    → ${err.message}`);
  }
}

// ── Generate unique email ───────────────────────────────────────────────────
function uniqueEmail() {
  return `test-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.com`;
}

// ── Tests ───────────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n🧪 KAN-37: Auth Register Route Tests\n');

  // ── Test 1: Happy path — successful registration ────────────────────────
  await test('POST /v1/auth/register with valid data returns 201', async () => {
    const res = await makeRequest('POST', '/v1/auth/register', {
      name: 'Test User',
      email: uniqueEmail(),
      password: 'SecurePass123!',
    });

    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);

    // Content-Type should be application/json
    const contentType = res.headers['content-type'] || '';
    assert.ok(
      contentType.includes('application/json'),
      `Expected Content-Type to include application/json, got "${contentType}"`
    );

    // Response body should be an object
    assert.strictEqual(typeof res.body, 'object', 'Response body should be an object');
    assert.ok(res.body !== null, 'Response body should not be null');

    // Body should contain at least one of: id, email, token, user
    const hasExpectedField =
      'id' in res.body ||
      'email' in res.body ||
      'token' in res.body ||
      'user' in res.body ||
      'tokens' in res.body;
    assert.ok(hasExpectedField, 'Response should contain id, email, token, or user field');
  });

  // ── Test 2: Missing password → 400 ─────────────────────────────────────
  await test('POST /v1/auth/register without password returns 400', async () => {
    const res = await makeRequest('POST', '/v1/auth/register', {
      name: 'No Password User',
      email: uniqueEmail(),
      // password intentionally omitted
    });

    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);

    const contentType = res.headers['content-type'] || '';
    assert.ok(
      contentType.includes('application/json'),
      `Expected JSON response, got "${contentType}"`
    );
  });

  // ── Test 3: Invalid email format → 400 ─────────────────────────────────
  await test('POST /v1/auth/register with invalid email returns 400', async () => {
    const res = await makeRequest('POST', '/v1/auth/register', {
      name: 'Bad Email User',
      email: 'not-an-email',
      password: 'SecurePass123!',
    });

    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);

    const contentType = res.headers['content-type'] || '';
    assert.ok(
      contentType.includes('application/json'),
      `Expected JSON response, got "${contentType}"`
    );
  });

  // ── Test 4: Duplicate registration → first 201, second 4xx ─────────────
  await test('Duplicate registration returns 4xx on second attempt', async () => {
    const email = uniqueEmail();
    const payload = {
      name: 'Duplicate User',
      email,
      password: 'SecurePass123!',
    };

    // First registration should succeed
    const first = await makeRequest('POST', '/v1/auth/register', payload);
    assert.strictEqual(first.status, 201, `First registration: expected 201, got ${first.status}`);

    // Second registration with same email should fail
    const second = await makeRequest('POST', '/v1/auth/register', payload);
    assert.ok(
      second.status >= 400 && second.status < 500,
      `Second registration: expected 4xx, got ${second.status}`
    );

    const contentType = second.headers['content-type'] || '';
    assert.ok(
      contentType.includes('application/json'),
      `Expected JSON error response, got "${contentType}"`
    );
  });

  // ── Test 5: Unknown auth route → 404 ───────────────────────────────────
  await test('GET /v1/auth/nonexistent returns 404', async () => {
    const res = await makeRequest('GET', '/v1/auth/nonexistent');

    assert.strictEqual(res.status, 404, `Expected 404, got ${res.status}`);
  });

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${'─'.repeat(50)}\n`);
}

// ── Execute with timeout guard ──────────────────────────────────────────────
const timeout = setTimeout(() => {
  console.error('✗ Tests timed out after ' + TIMEOUT_MS + 'ms');
  process.exit(1);
}, TIMEOUT_MS);

runTests()
  .then(() => {
    clearTimeout(timeout);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    clearTimeout(timeout);
    console.error('✗ Unexpected error:', err.message);
    process.exit(1);
  });
