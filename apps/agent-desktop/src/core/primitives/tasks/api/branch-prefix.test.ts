import { describe, expect, it } from 'vitest';
import { normalizeBranchPrefix } from './branch-prefix';

describe('normalizeBranchPrefix', () => {
  it('strips trailing slashes', () => {
    expect(normalizeBranchPrefix('agent/')).toBe('agent');
    expect(normalizeBranchPrefix('agent///')).toBe('agent');
  });

  it('strips leading slashes', () => {
    expect(normalizeBranchPrefix('/agent')).toBe('agent');
    expect(normalizeBranchPrefix('///agent')).toBe('agent');
    expect(normalizeBranchPrefix('/team/agent/')).toBe('team/agent');
  });

  it('trims whitespace', () => {
    expect(normalizeBranchPrefix('  agent/  ')).toBe('agent');
  });

  it('preserves internal slashes', () => {
    expect(normalizeBranchPrefix('team/agent')).toBe('team/agent');
  });

  it('leaves valid prefixes unchanged', () => {
    expect(normalizeBranchPrefix('agent')).toBe('agent');
    expect(normalizeBranchPrefix('')).toBe('');
  });
});
