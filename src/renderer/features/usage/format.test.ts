import { describe, expect, it } from 'vitest';
import { fmtTokens, fmtUsd } from './format';

describe('fmtTokens', () => {
  it('uses compact suffixes', () => {
    expect(fmtTokens(950)).toBe('950');
    expect(fmtTokens(1_500)).toBe('1.5K');
    expect(fmtTokens(128_800_000)).toBe('128.8M');
    expect(fmtTokens(2_400_000_000)).toBe('2.4B');
  });
});

describe('fmtUsd', () => {
  it('formats whole-dollar currency with separators', () => {
    expect(fmtUsd(3078)).toBe('$3,078');
    expect(fmtUsd(0)).toBe('$0');
  });
});
