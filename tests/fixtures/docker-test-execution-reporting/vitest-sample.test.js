// Sample Vitest test file for Docker execution testing
import { describe, test, expect } from 'vitest';

describe('Sample Vitest Test Suite', () => {
  test('should pass basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  test('should handle async operations', async () => {
    const result = await Promise.resolve('success');
    expect(result).toBe('success');
  });

  test('should validate object properties', () => {
    const user = { name: 'John', age: 30 };
    expect(user).toHaveProperty('name', 'John');
    expect(user.age).toBeGreaterThan(18);
  });
});
