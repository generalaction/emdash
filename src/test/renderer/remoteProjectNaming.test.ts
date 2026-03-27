import { describe, expect, it } from 'vitest';
import {
  deriveRemoteProjectName,
  resolveRemoteProjectName,
} from '../../renderer/lib/remoteProjectNaming';

describe('remote project naming', () => {
  it('derives the default name from the selected remote directory', () => {
    expect(deriveRemoteProjectName('/home/dev/foo/bar')).toBe('bar');
    expect(deriveRemoteProjectName('/home/dev/foo/bar/')).toBe('bar');
  });

  it('falls back to the connection name when the path has no basename', () => {
    expect(deriveRemoteProjectName('/', 'My Server')).toBe('My Server');
    expect(deriveRemoteProjectName('', 'My Server')).toBe('My Server');
  });

  it('keeps a custom project name after the user edits it', () => {
    expect(
      resolveRemoteProjectName({
        remotePath: '/srv/workspaces/repo-a',
        fallbackName: 'My Server',
        currentName: 'workspace-a/repo-a',
        wasCustomized: true,
      })
    ).toBe('workspace-a/repo-a');
  });

  it('updates the auto-filled name when the selected path changes', () => {
    expect(
      resolveRemoteProjectName({
        remotePath: '/srv/workspaces/repo-b',
        fallbackName: 'My Server',
        currentName: 'repo-a',
        wasCustomized: false,
      })
    ).toBe('repo-b');
  });
});
