// @ts-expect-error - Fixture file for testing Mocha parser, Mocha/Chai not installed
import { describe, it } from 'mocha';
import { expect } from 'chai';

describe('Calculator', () => {
  it('should add two numbers', () => {
    expect(2 + 2).to.equal(4);
  });

  it('should subtract two numbers', () => {
    expect(5 - 3).to.equal(2);
  });

  it('should multiply two numbers', () => {
    expect(3 * 4).to.equal(12);
  });
});
