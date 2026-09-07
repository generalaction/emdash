import { describe, expect, it } from 'vitest';
import {
  relativeToWorkspace,
  resolveWorkspacePath,
} from '@core/features/workspaces/api/browser/workspace-path';

describe('resolveWorkspacePath', () => {
  it('resolves relative restored paths under the workspace root', () => {
    expect(resolveWorkspacePath('/repo', 'src/index.ts')).toBe('/repo/src/index.ts');
  });

  it('preserves absolute paths', () => {
    expect(resolveWorkspacePath('/repo', '/other/index.ts')).toBe('/other/index.ts');
    expect(resolveWorkspacePath('/repo', 'C:\\work\\index.ts')).toBe('C:\\work\\index.ts');
    expect(resolveWorkspacePath('/repo', '\\\\server\\share\\index.ts')).toBe(
      '\\\\server\\share\\index.ts'
    );
  });

  it('uses the workspace host dialect for relative paths', () => {
    expect(resolveWorkspacePath('C:\\repo', 'src/index.ts')).toBe('C:\\repo\\src\\index.ts');
    expect(resolveWorkspacePath('\\\\server\\share\\repo', 'src/index.ts')).toBe(
      '\\\\server\\share\\repo\\src\\index.ts'
    );
  });
});

describe('relativeToWorkspace', () => {
  it('returns a workspace-relative display path for workspace files', () => {
    expect(relativeToWorkspace('/repo', '/repo/src/index.ts')).toBe('src/index.ts');
  });

  it('returns the original host spelling for files outside the workspace', () => {
    expect(relativeToWorkspace('/repo', '/other/index.ts')).toBe('/other/index.ts');
    expect(relativeToWorkspace('C:\\repo', 'C:\\other\\index.ts')).toBe('C:\\other\\index.ts');
    expect(
      relativeToWorkspace('\\\\server\\share\\repo', '\\\\server\\other-share\\index.ts')
    ).toBe('\\\\server\\other-share\\index.ts');
  });
});
