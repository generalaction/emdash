import { minimatch } from 'minimatch';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WATCHER_EXCLUDE } from '#primitives/exclusion-policy/api';
import { gitMetadataWatchProfile, workspaceContentWatchIgnore } from './profiles';

describe('workspaceContentWatchIgnore', () => {
  it('excludes Git metadata and the built-in high-volume trees by default', () => {
    const ignore = workspaceContentWatchIgnore();
    expect(ignore).toEqual(['.git/**', ...DEFAULT_WATCHER_EXCLUDE]);
    expect(ignore).toContain('**/node_modules/**');
  });

  it('skips Flutter build output at the root only, keeping nested build/ sources watched', () => {
    // Native watchers and the files runtime match ignore globs against root-relative paths.
    const ignored = (path: string) =>
      workspaceContentWatchIgnore().some((glob) => minimatch(path, glob, { dot: true }));
    expect(ignored('build/app/outputs/a.apk')).toBe(true);
    expect(ignored('.dart_tool/package_config.json')).toBe(true);
    expect(ignored('ios/Pods/Manifest.lock')).toBe(true);
    expect(ignored('apps/emdash-desktop/build/entitlements.plist')).toBe(false);
    expect(ignored('lib/main.dart')).toBe(false);
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

describe('gitMetadataWatchProfile', () => {
  it('skips only the object stores', () => {
    expect(gitMetadataWatchProfile().ignore).toEqual([
      'lfs/**',
      'modules/**',
      'objects/**',
      'subtree-cache/**',
      'worktrees/*/modules/**',
    ]);
  });

  it('pins the operating-system watcher so the ignore list bounds the initial crawl', () => {
    expect(gitMetadataWatchProfile().backend).toBe('os');
  });

  it('returns a fresh ignore list for every consumer', () => {
    const first = gitMetadataWatchProfile();
    first.ignore.push('refs/**');
    expect(gitMetadataWatchProfile().ignore).not.toContain('refs/**');
  });
});
