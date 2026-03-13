import { describe, test, expect } from 'vitest';

describe('Calculator', () => {
  test('should add two numbers', () => {
    expect(2 + 2).toBe(4);
  });

  test('should subtract two numbers', () => {
    expect(5 - 3).toBe(2);
  });

  test('should multiply two numbers', () => {
    expect(3 * 4).toBe(12);
  });
});
