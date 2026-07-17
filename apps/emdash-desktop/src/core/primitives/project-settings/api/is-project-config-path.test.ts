import { describe, expect, it } from 'vitest';
import { isProjectConfigPath, PROJECT_CONFIG_FILE } from './project-settings';

describe('isProjectConfigPath', () => {
  it('matches the absolute workspace-root config path (current event shape)', () => {
    expect(isProjectConfigPath(`/repo/${PROJECT_CONFIG_FILE}`)).toBe(true);
    expect(isProjectConfigPath('/Users/me/worktrees/feature/.emdash.json')).toBe(true);
  });

  it('matches the legacy relative config path', () => {
    expect(isProjectConfigPath(PROJECT_CONFIG_FILE)).toBe(true);
  });

  it('matches Windows-style separators', () => {
    expect(isProjectConfigPath('C:\\repo\\.emdash.json')).toBe(true);
  });

  it('does not match unrelated files', () => {
    expect(isProjectConfigPath('/repo/src/index.ts')).toBe(false);
    expect(isProjectConfigPath('/repo/.emdash.json.bak')).toBe(false);
    expect(isProjectConfigPath('/repo/not-emdash.json')).toBe(false);
  });
});
