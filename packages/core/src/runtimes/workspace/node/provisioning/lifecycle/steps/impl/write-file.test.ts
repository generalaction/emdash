import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileImpl } from './write-file';

let root: string;

describe('writeFileImpl', () => {
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'emdash-write-file-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes content inside the resolved workspace path', async () => {
    const result = await writeFileImpl.execute(
      { path: 'docs/README.md', content: '# Repo\n' },
      { repoPath: '/repo', resolvedWorktreePath: root, preservePatterns: [] }
    );

    expect(result.success).toBe(true);
    await expect(readFile(path.join(root, 'docs/README.md'), 'utf8')).resolves.toBe('# Repo\n');
  });

  it('rejects paths that escape the workspace', async () => {
    const result = await writeFileImpl.execute(
      { path: '../outside.md', content: 'nope' },
      { repoPath: root, preservePatterns: [] }
    );

    expect(result).toEqual({
      success: false,
      class: 'permanent',
      error: {
        type: 'invalid-path',
        message: 'File path "../outside.md" escapes the workspace',
        resolutions: ['use-relative-path'],
      },
    });
  });
});
