import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { BriefReaderDependencies, GitOutput } from './repository';

/** Large enough for any task file; small enough that a rogue path cannot blow up the process. */
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const GIT_TIMEOUT_MS = 15_000;

/**
 * The real filesystem and git bindings for the markdown reader. Read-only by
 * construction: only `rev-parse`, `ls-tree`, `log` and `show` are ever run,
 * and no code path writes to a task file.
 */
export const nodeBriefReader: BriefReaderDependencies = {
  git(repositoryPath, args) {
    return new Promise<GitOutput>((resolve) => {
      execFile(
        'git',
        [...args],
        {
          cwd: repositoryPath,
          maxBuffer: MAX_GIT_OUTPUT_BYTES,
          timeout: GIT_TIMEOUT_MS,
          windowsHide: true,
          encoding: 'utf8',
        },
        (error, stdout) => {
          if (error) {
            resolve({ status: 'failed', message: error.message });
            return;
          }
          resolve({ status: 'ok', stdout });
        }
      );
    });
  },

  readFile(absolutePath) {
    return readFile(absolutePath, 'utf8');
  },

  async readDirectory(absolutePath) {
    const entries = await readdir(absolutePath, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  },

  async modifiedAt(absolutePath) {
    try {
      return (await stat(absolutePath)).mtime.toISOString();
    } catch {
      return undefined;
    }
  },
};
