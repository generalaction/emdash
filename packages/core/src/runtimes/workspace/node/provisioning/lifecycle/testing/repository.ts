import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type TestRepository = {
  root: string;
  repoPath: string;
  worktreePoolPath: string;
  cleanup(): Promise<void>;
};

export async function createTestRepository(): Promise<TestRepository> {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-bootstrap-'));
  const repoPath = path.join(root, 'repo');
  const worktreePoolPath = path.join(root, 'worktrees');
  await mkdir(repoPath, { recursive: true });
  await mkdir(worktreePoolPath, { recursive: true });

  await execGit(repoPath, ['init', '-b', 'main']);
  await execGit(repoPath, ['config', 'user.email', 'test@example.com']);
  await execGit(repoPath, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repoPath, 'README.md'), '# Test\n');
  await execGit(repoPath, ['add', 'README.md']);
  await execGit(repoPath, ['commit', '-m', 'initial']);

  return {
    root,
    repoPath,
    worktreePoolPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function execGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (!error) {
        resolve({ stdout, stderr });
        return;
      }
      reject(Object.assign(error, { stdout, stderr }));
    });
  });
}
