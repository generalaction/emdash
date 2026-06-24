import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveGitBin } from './exec';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-git-bin-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function executableGit(directory: string): string {
  fs.mkdirSync(directory, { recursive: true });
  const gitPath = path.join(directory, 'git');
  fs.writeFileSync(gitPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return gitPath;
}

describe('resolveGitBin', () => {
  it('prefers explicit GIT_PATH over PATH git', () => {
    const pathGit = executableGit(path.join(tempDir, 'path-bin'));
    const explicitGit = executableGit(path.join(tempDir, 'explicit-bin'));

    expect(resolveGitBin({ GIT_PATH: explicitGit, PATH: path.dirname(pathGit) })).toBe(explicitGit);
  });

  it('prefers PATH git before hardcoded fallbacks', () => {
    const pathGit = executableGit(path.join(tempDir, 'path-bin'));

    expect(resolveGitBin({ PATH: path.dirname(pathGit) })).toBe(pathGit);
  });
});
