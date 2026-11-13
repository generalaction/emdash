import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PortableRelativePath } from '#primitives/path/api';
import { createBoundExec } from '#services/exec/api';
import { readGitFileContent } from './content';

describe('readGitFileContent', () => {
  it('reads an unmerged path from the index as its stage-2 (HEAD) version', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'git-content-'));
    try {
      const git = (args: string[], input?: string) =>
        execFileSync('git', args, { cwd: root, input, encoding: 'utf8' });
      git(['init', '-q']);
      const base = git(['hash-object', '-w', '--stdin'], 'base\n').trim();
      const ours = git(['hash-object', '-w', '--stdin'], 'ours\n').trim();
      git(['update-index', '--index-info'], `100644 ${base} 1\tf.txt\n100644 ${ours} 2\tf.txt\n`);

      const result = await readGitFileContent(
        createBoundExec({ file: 'git', cwd: root }),
        'f.txt' as PortableRelativePath,
        { kind: 'index' }
      );

      expect(result).toMatchObject({ kind: 'text', content: 'ours\n' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
