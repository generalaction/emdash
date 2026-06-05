import { describe, expect, it } from 'vitest';
import { normalizeBranchPrefix } from './branch-prefix';

describe('normalizeBranchPrefix', () => {
  it('strips trailing slashes', () => {
    expect(normalizeBranchPrefix('emdash/')).toBe('rundash');
    expect(normalizeBranchPrefix('emdash///')).toBe('rundash');
  });

  it('strips leading slashes', () => {
    expect(normalizeBranchPrefix('/emdash')).toBe('rundash');
    expect(normalizeBranchPrefix('///emdash')).toBe('rundash');
    expect(normalizeBranchPrefix('/team/emdash/')).toBe('team/emdash');
  });

  it('trims whitespace', () => {
    expect(normalizeBranchPrefix('  emdash/  ')).toBe('rundash');
  });

  it('preserves internal slashes', () => {
    expect(normalizeBranchPrefix('team/emdash')).toBe('team/emdash');
  });

  it('leaves valid prefixes unchanged', () => {
    expect(normalizeBranchPrefix('rundash')).toBe('rundash');
    expect(normalizeBranchPrefix('')).toBe('');
  });
});
