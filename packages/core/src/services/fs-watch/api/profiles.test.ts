import { describe, expect, it } from 'vitest';
import { DEFAULT_WATCHER_EXCLUDE } from '#primitives/exclusion-policy/api';
import { gitMetadataWatchIgnore, workspaceContentWatchIgnore } from './profiles';

describe('workspaceContentWatchIgnore', () => {
  it('excludes Git metadata and the built-in high-volume trees by default', () => {
    const ignore = workspaceContentWatchIgnore();
    expect(ignore).toEqual(['.git/**', ...DEFAULT_WATCHER_EXCLUDE]);
    expect(ignore).toContain('**/node_modules/**');
  });

  it('lets the host list replace the defaults while keeping the structural rule', () => {
    expect(workspaceContentWatchIgnore(['**/dist/**'])).toEqual(['.git/**', '**/dist/**']);
  });

  it('treats an empty host list as no optional exclusions', () => {
    expect(workspaceContentWatchIgnore([])).toEqual(['.git/**']);
  });

  it('normalizes and deduplicates host patterns', () => {
    expect(
      workspaceContentWatchIgnore([' **/dist/** ', '**/dist/**', '.git/**', 'build\\**'])
    ).toEqual(['.git/**', '**/dist/**', 'build/**']);
  });
});

describe('gitMetadataWatchIgnore', () => {
  it('skips only the object store and subtree cache', () => {
    expect(gitMetadataWatchIgnore()).toEqual(['objects/**', 'subtree-cache/**']);
  });
});
