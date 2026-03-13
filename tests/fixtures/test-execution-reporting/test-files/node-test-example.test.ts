import { describe, test } from 'node:test';
import assert from 'node:assert';

// Fixture file for testing Node.js test runner parser
void describe('Calculator', () => {
  void test('should add two numbers', () => {
    assert.strictEqual(2 + 2, 4);
  });

  void test('should subtract two numbers', () => {
    assert.strictEqual(5 - 3, 2);
  });

  void test('should multiply two numbers', () => {
    assert.strictEqual(3 * 4, 12);
  });
});
