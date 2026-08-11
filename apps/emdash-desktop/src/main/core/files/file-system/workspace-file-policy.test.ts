import { describe, expect, it } from 'vitest';
import { resolveWorkspacePath } from './workspace-file-policy';

describe('resolveWorkspacePath', () => {
  it('resolves portable relative paths under a POSIX workspace', () => {
    expect(resolveWorkspacePath('/repo', 'src/file.ts')).toEqual({
      success: true,
      data: { path: '/repo/src/file.ts' },
    });
  });

  it('normalizes native Windows separators at the application boundary', () => {
    expect(resolveWorkspacePath('C:\\repo', 'src\\file.ts')).toEqual({
      success: true,
      data: { path: 'C:\\repo\\src\\file.ts' },
    });
  });

  it('rejects paths outside the workspace', () => {
    expect(resolveWorkspacePath('/repo', '../outside')).toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
    expect(resolveWorkspacePath('C:\\repo', 'D:\\outside')).toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
  });
});
