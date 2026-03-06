import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getFileDiff, getCommitFileDiff } from '../../main/services/GitService';

const exec = promisify(execFile);

async function initRepo(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'diff-test-'));
  await exec('git', ['init'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

async function commitFile(dir: string, name: string, content: string, msg: string): Promise<void> {
  await fs.promises.writeFile(path.join(dir, name), content);
  await exec('git', ['add', name], { cwd: dir });
  await exec('git', ['commit', '-m', msg], { cwd: dir });
}

describe('getFileDiff (integration)', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await initRepo();
  });

  afterEach(async () => {
    await fs.promises.rm(repo, { recursive: true, force: true });
  });

  it('should return diff lines and full content for a modified text file', async () => {
    await commitFile(repo, 'file.txt', 'hello\nworld\n', 'init');
    await fs.promises.writeFile(path.join(repo, 'file.txt'), 'hello\nchanged\n');

    const result = await getFileDiff(repo, 'file.txt');

    expect(result.isBinary).toBeFalsy();
    expect(result.originalContent).toBe('hello\nworld');
    expect(result.modifiedContent).toBe('hello\nchanged');
    expect(result.lines).toContainEqual({ left: 'world', type: 'del' });
    expect(result.lines).toContainEqual({ right: 'changed', type: 'add' });
    expect(result.lines).toContainEqual({ left: 'hello', right: 'hello', type: 'context' });
  });

  it('should handle an untracked file (no HEAD version)', async () => {
    // Need at least one commit for HEAD to exist
    await commitFile(repo, 'init.txt', 'x\n', 'init');
    await fs.promises.writeFile(path.join(repo, 'new.txt'), 'line1\nline2\n');

    const result = await getFileDiff(repo, 'new.txt');

    expect(result.originalContent).toBeUndefined();
    expect(result.modifiedContent).toBe('line1\nline2');
    expect(result.lines.every((l) => l.type === 'add')).toBe(true);
  });

  it('should handle a deleted file (exists at HEAD, removed from disk)', async () => {
    await commitFile(repo, 'doomed.txt', 'goodbye\nworld\n', 'init');
    await fs.promises.unlink(path.join(repo, 'doomed.txt'));

    const result = await getFileDiff(repo, 'doomed.txt');

    expect(result.originalContent).toBe('goodbye\nworld');
    expect(result.modifiedContent).toBeUndefined();
    expect(result.lines.every((l) => l.type === 'del')).toBe(true);
  });

  it('should detect a binary file and not return content', async () => {
    // PNG header bytes — git will detect this as binary
    const png = Buffer.alloc(256);
    png[0] = 0x89;
    png[1] = 0x50;
    png[2] = 0x4e;
    png[3] = 0x47;
    png[4] = 0x0d;
    png[5] = 0x0a;
    png[6] = 0x1a;
    png[7] = 0x0a;
    await fs.promises.writeFile(path.join(repo, 'img.png'), png);
    await exec('git', ['add', 'img.png'], { cwd: repo });
    await exec('git', ['commit', '-m', 'add image'], { cwd: repo });
    // Modify the binary
    png[100] = 0xff;
    await fs.promises.writeFile(path.join(repo, 'img.png'), png);

    const result = await getFileDiff(repo, 'img.png');

    expect(result.isBinary).toBe(true);
    expect(result.lines).toEqual([]);
    expect(result.originalContent).toBeUndefined();
    expect(result.modifiedContent).toBeUndefined();
  });

  it('should handle a file changed to empty (modifiedContent is empty string, not undefined)', async () => {
    await commitFile(repo, 'file.txt', 'content\n', 'init');
    await fs.promises.writeFile(path.join(repo, 'file.txt'), '');

    const result = await getFileDiff(repo, 'file.txt');

    expect(result.originalContent).toBe('content');
    expect(result.modifiedContent).toBe('');
  });

  it('should return undefined content for files exceeding MAX_DIFF_CONTENT_BYTES', async () => {
    // Create a file just over 512KB
    const bigContent = 'x'.repeat(520 * 1024) + '\n';
    await commitFile(repo, 'big.txt', bigContent, 'init');
    // Small modification so diff is manageable
    const modified = 'y' + bigContent.slice(1);
    await fs.promises.writeFile(path.join(repo, 'big.txt'), modified);

    const result = await getFileDiff(repo, 'big.txt');

    // Content exceeds 512KB — should be undefined
    expect(result.originalContent).toBeUndefined();
    expect(result.modifiedContent).toBeUndefined();
    // Diff lines should still work
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it('should handle a file in an empty repo (no HEAD)', async () => {
    // repo has no commits — git diff HEAD will fail
    await fs.promises.writeFile(path.join(repo, 'first.txt'), 'hello\n');

    const result = await getFileDiff(repo, 'first.txt');

    expect(result.originalContent).toBeUndefined();
    expect(result.modifiedContent).toBe('hello');
    expect(result.lines.every((l) => l.type === 'add')).toBe(true);
  });

  it('should reject paths outside the worktree', async () => {
    await expect(getFileDiff(repo, '../../../etc/passwd')).rejects.toThrow(
      'File path is outside the worktree'
    );
  });
});

describe('getCommitFileDiff (integration)', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await initRepo();
  });

  afterEach(async () => {
    await fs.promises.rm(repo, { recursive: true, force: true });
  });

  it('should return diff lines and content for a normal commit', async () => {
    await commitFile(repo, 'file.txt', 'hello\nworld\n', 'first');
    await fs.promises.writeFile(path.join(repo, 'file.txt'), 'hello\nchanged\n');
    await exec('git', ['add', 'file.txt'], { cwd: repo });
    await exec('git', ['commit', '-m', 'second'], { cwd: repo });
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
    const hash = stdout.trim();

    const result = await getCommitFileDiff(repo, hash, 'file.txt');

    expect(result.isBinary).toBeFalsy();
    expect(result.originalContent).toBe('hello\nworld');
    expect(result.modifiedContent).toBe('hello\nchanged');
    expect(result.lines).toContainEqual({ left: 'world', type: 'del' });
    expect(result.lines).toContainEqual({ right: 'changed', type: 'add' });
  });

  it('should handle a root commit (no parent)', async () => {
    await commitFile(repo, 'file.txt', 'first\nfile\n', 'root');
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
    const hash = stdout.trim();

    const result = await getCommitFileDiff(repo, hash, 'file.txt');

    expect(result.originalContent).toBeUndefined();
    expect(result.modifiedContent).toBe('first\nfile');
    expect(result.lines.every((l) => l.type === 'add')).toBe(true);
  });

  it('should handle a root commit with an empty file', async () => {
    await fs.promises.writeFile(path.join(repo, 'empty.txt'), '');
    await exec('git', ['add', 'empty.txt'], { cwd: repo });
    await exec('git', ['commit', '-m', 'root'], { cwd: repo });
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
    const hash = stdout.trim();

    const result = await getCommitFileDiff(repo, hash, 'empty.txt');

    expect(result.modifiedContent).toBe('');
    expect(result.lines).toEqual([]);
  });

  it('should detect binary files in commits', async () => {
    const png = Buffer.alloc(256);
    png[0] = 0x89;
    png[1] = 0x50;
    png[2] = 0x4e;
    png[3] = 0x47;
    png[4] = 0x0d;
    png[5] = 0x0a;
    png[6] = 0x1a;
    png[7] = 0x0a;
    await fs.promises.writeFile(path.join(repo, 'img.png'), png);
    await exec('git', ['add', 'img.png'], { cwd: repo });
    await exec('git', ['commit', '-m', 'add image'], { cwd: repo });
    png[100] = 0xff;
    await fs.promises.writeFile(path.join(repo, 'img.png'), png);
    await exec('git', ['add', 'img.png'], { cwd: repo });
    await exec('git', ['commit', '-m', 'modify image'], { cwd: repo });
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
    const hash = stdout.trim();

    const result = await getCommitFileDiff(repo, hash, 'img.png');

    expect(result.isBinary).toBe(true);
    expect(result.lines).toEqual([]);
    expect(result.originalContent).toBeUndefined();
    expect(result.modifiedContent).toBeUndefined();
  });

  it('should handle a deleted file in a commit', async () => {
    await commitFile(repo, 'file.txt', 'content\n', 'add');
    await exec('git', ['rm', 'file.txt'], { cwd: repo });
    await exec('git', ['commit', '-m', 'delete'], { cwd: repo });
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
    const hash = stdout.trim();

    const result = await getCommitFileDiff(repo, hash, 'file.txt');

    expect(result.originalContent).toBe('content');
    expect(result.modifiedContent).toBeUndefined();
    expect(result.lines.every((l) => l.type === 'del')).toBe(true);
  });

  it('should reject paths outside the worktree', async () => {
    await commitFile(repo, 'file.txt', 'x\n', 'init');
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
    const hash = stdout.trim();

    await expect(getCommitFileDiff(repo, hash, '../../../etc/passwd')).rejects.toThrow(
      'File path is outside the worktree'
    );
  });
});
