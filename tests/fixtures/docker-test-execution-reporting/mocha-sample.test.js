// Sample Mocha test file for Docker execution testing
const assert = require('assert');

describe('Sample Mocha Test Suite', function() {
  it('should pass basic assertion', function() {
    assert.strictEqual(1 + 1, 2);
  });

  it('should handle async operations', async function() {
    const result = await Promise.resolve('success');
    assert.strictEqual(result, 'success');
  });

  it('should validate object properties', function() {
    const user = { name: 'John', age: 30 };
    assert.strictEqual(user.name, 'John');
    assert.ok(user.age > 18);
  });
});
