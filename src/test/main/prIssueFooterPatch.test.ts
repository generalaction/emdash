import fs from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { patchCurrentPrBodyWithIssueFooter } from '../../main/lib/prIssueFooterPatch';

describe('patchCurrentPrBodyWithIssueFooter', () => {
  it('reads existing body and updates PR body with injected issue footer', async () => {
    let capturedBodyFilePath = '';
    let capturedBodyFileContent = '';

    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: '## Summary\nPreserve this body' };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        const bodyFileIdx = args.indexOf('--body-file');
        expect(bodyFileIdx).toBeGreaterThan(-1);
        capturedBodyFilePath = args[bodyFileIdx + 1];
        capturedBodyFileContent = fs.readFileSync(capturedBodyFilePath, 'utf8');
        expect(args[2]).toBe('https://github.com/generalaction/emdash/pull/123');
        return { stdout: '' };
      }
      throw new Error(`Unexpected command args: ${args.join(' ')}`);
    });

    const didPatch = await patchCurrentPrBodyWithIssueFooter({
      taskPath: '/tmp/worktree',
      metadata: { githubIssue: { number: 42 } },
      execFile,
      prUrl: 'https://github.com/generalaction/emdash/pull/123',
    });

    expect(didPatch).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(capturedBodyFileContent).toContain('## Summary');
    expect(capturedBodyFileContent).toContain('Fixes #42');
    expect(fs.existsSync(capturedBodyFilePath)).toBe(false);
  });

  it('returns false and skips edit when no issue footer changes are required', async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: '## Summary\nAlready final body' };
      }
      throw new Error(`Unexpected command args: ${args.join(' ')}`);
    });

    const didPatch = await patchCurrentPrBodyWithIssueFooter({
      taskPath: '/tmp/worktree',
      metadata: {},
      execFile,
    });

    expect(didPatch).toBe(false);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it('edits without explicit PR URL when none is provided', async () => {
    const execFile = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: 'Body text' };
      }
      if (args[0] === 'pr' && args[1] === 'edit') {
        expect(args[2]).toBe('--body-file');
        return { stdout: '' };
      }
      throw new Error(`Unexpected command args: ${args.join(' ')}`);
    });

    const didPatch = await patchCurrentPrBodyWithIssueFooter({
      taskPath: '/tmp/worktree',
      metadata: { linearIssue: { identifier: 'ABC-42' } },
      execFile,
    });

    expect(didPatch).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(2);
  });
});
