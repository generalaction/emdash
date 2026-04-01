import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getStatus } from '../../main/services/GitService';

const exec = promisify(execFile);

async function initRepo(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'git-status-test-'));
  await exec('git', ['init'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

async function commitFile(dir: string, name: string, content: string | Buffer, msg: string) {
  await fs.promises.writeFile(path.join(dir, name), content);
  await exec('git', ['add', name], { cwd: dir });
  await exec('git', ['commit', '-m', msg], { cwd: dir });
}

describe('GitService.getStatus', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await initRepo();
  });

  afterEach(async () => {
    await fs.promises.rm(repo, { recursive: true, force: true });
  });

  it('surfaces deleted tracked files as deleted status', async () => {
    await commitFile(repo, 'deleted.txt', 'content\n', 'init');
    await fs.promises.unlink(path.join(repo, 'deleted.txt'));

    const status = await getStatus(repo);
    const change = status.find((entry) => entry.path === 'deleted.txt');

    expect(change).toBeDefined();
    expect(change?.status).toBe('deleted');
    expect(change?.isStaged).toBe(false);
  });

  it('keeps unknown binary stats as null instead of zero', async () => {
    const png = Buffer.alloc(2048);
    png[0] = 0x89;
    png[1] = 0x50;
    png[2] = 0x4e;
    png[3] = 0x47;
    png[4] = 0x0d;
    png[5] = 0x0a;
    png[6] = 0x1a;
    png[7] = 0x0a;

    await commitFile(repo, 'image.png', png, 'add image');

    png[128] = 0xff;
    await fs.promises.writeFile(path.join(repo, 'image.png'), png);

    const status = await getStatus(repo);
    const change = status.find((entry) => entry.path === 'image.png');

    expect(change).toBeDefined();
    expect(change?.status).toBe('modified');
    expect(change?.additions).toBeNull();
    expect(change?.deletions).toBeNull();
  });

  it('maps rename entries to the destination path', async () => {
    await commitFile(repo, 'old-name.ts', 'export const x = 1;\n', 'init');
    await exec('git', ['mv', 'old-name.ts', 'new-name.ts'], { cwd: repo });

    const status = await getStatus(repo);
    const change = status.find((entry) => entry.path === 'new-name.ts');

    expect(change).toBeDefined();
    expect(change?.status).toBe('renamed');
    expect(change?.isStaged).toBe(true);
  });

  it('excludes untracked files when includeUntracked is false', async () => {
    await commitFile(repo, 'tracked.txt', 'content\n', 'init');

    // Create an untracked file
    await fs.promises.writeFile(path.join(repo, 'untracked.txt'), 'new file\n');
    // Modify a tracked file
    await fs.promises.writeFile(path.join(repo, 'tracked.txt'), 'modified\n');

    const withUntracked = await getStatus(repo, { includeUntracked: true });
    const withoutUntracked = await getStatus(repo, { includeUntracked: false });

    expect(withUntracked.some((e) => e.path === 'untracked.txt')).toBe(true);
    expect(withUntracked.some((e) => e.path === 'tracked.txt')).toBe(true);

    expect(withoutUntracked.some((e) => e.path === 'untracked.txt')).toBe(false);
    const tracked = withoutUntracked.find((e) => e.path === 'tracked.txt');
    expect(tracked).toBeDefined();
    expect(tracked?.status).toBe('modified');
  });
});
