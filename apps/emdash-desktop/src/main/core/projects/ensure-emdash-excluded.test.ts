import { describe, expect, it, vi } from 'vitest';
import type { FileSystemProvider } from '@main/core/fs/types';
import { ensureEmdashGitExcluded } from './ensure-emdash-excluded';

function makeFs(opts: {
  gitType?: 'dir' | 'file';
  excludeContent?: string | null;
  truncated?: boolean;
}) {
  const write = vi.fn(async () => ({ success: true, bytesWritten: 1 }));
  const fs = {
    stat: vi.fn(async (p: string) =>
      p === '.git' && opts.gitType ? { type: opts.gitType } : null
    ),
    exists: vi.fn(async () => opts.excludeContent != null),
    read: vi.fn(async () => ({
      content: opts.excludeContent ?? '',
      truncated: opts.truncated ?? false,
      totalSize: 0,
    })),
    write,
  } as unknown as FileSystemProvider;
  return { fs, write };
}

describe('ensureEmdashGitExcluded', () => {
  it('skips repos without a real .git directory (linked worktree / submodule)', async () => {
    const { fs, write } = makeFs({ gitType: 'file', excludeContent: '' });
    await ensureEmdashGitExcluded(fs);
    expect(write).not.toHaveBeenCalled();
  });

  it('skips when there is no .git at all', async () => {
    const { fs, write } = makeFs({ excludeContent: '' });
    await ensureEmdashGitExcluded(fs);
    expect(write).not.toHaveBeenCalled();
  });

  it('creates the exclude entry when info/exclude is missing', async () => {
    const { fs, write } = makeFs({ gitType: 'dir', excludeContent: null });
    await ensureEmdashGitExcluded(fs);
    expect(write).toHaveBeenCalledWith('.git/info/exclude', '.emdash/\n');
  });

  it('appends the entry, preserving existing exclude content', async () => {
    const { fs, write } = makeFs({ gitType: 'dir', excludeContent: '# git ls-files\nbuild/\n' });
    await ensureEmdashGitExcluded(fs);
    expect(write).toHaveBeenCalledWith('.git/info/exclude', '# git ls-files\nbuild/\n.emdash/\n');
  });

  it('does nothing when .emdash/ is already excluded', async () => {
    const { fs, write } = makeFs({ gitType: 'dir', excludeContent: 'foo\n.emdash/\n' });
    await ensureEmdashGitExcluded(fs);
    expect(write).not.toHaveBeenCalled();
  });

  it('treats a slashless .emdash entry as already excluded', async () => {
    const { fs, write } = makeFs({ gitType: 'dir', excludeContent: '.emdash\n' });
    await ensureEmdashGitExcluded(fs);
    expect(write).not.toHaveBeenCalled();
  });

  it('does not rewrite when the exclude read was truncated', async () => {
    // A truncated view could miss an existing entry past the cut; rewriting it would
    // drop the tail of the file, so bail instead.
    const { fs, write } = makeFs({ gitType: 'dir', excludeContent: 'build/\n', truncated: true });
    await ensureEmdashGitExcluded(fs);
    expect(write).not.toHaveBeenCalled();
  });
});
