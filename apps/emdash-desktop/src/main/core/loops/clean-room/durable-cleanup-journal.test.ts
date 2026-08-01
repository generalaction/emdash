import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CleanRoomPendingCleanup } from './cleanup-journal';
import { DurableCleanRoomCleanupJournal } from './durable-cleanup-journal';

const roots: string[] = [];

function record(revision = 0): CleanRoomPendingCleanup {
  const base = '1'.repeat(40);
  return {
    version: '1',
    cleanupId: 'cleanup-loop-verify-run-1',
    verificationRunId: 'verification-1',
    attempt: 1,
    projectId: 'project-1',
    workspaceId: 'loop-verify-run-1',
    target: { path: '/tmp/loop-verify-run-1', machine: { kind: 'local' } },
    featureTarget: {
      workspaceId: 'feature-1',
      path: '/tmp/feature-1',
      machine: { kind: 'local' },
    },
    branchName: 'emdash/loop-verify-run-1',
    baseCommit: base,
    expectedFeatureHead: base,
    worktreeOwnership: 'intent',
    teardownRequired: false,
    branchHead: base,
    completed: { teardown: false, worktree: false, branch: false },
    revision,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('DurableCleanRoomCleanupJournal', () => {
  it('persists exact revision-CAS authority across instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-cleanup-journal-'));
    roots.push(root);
    const path = join(root, 'loops', 'cleanup.json');
    const first = new DurableCleanRoomCleanupJournal(path);
    expect(await first.save(record(), null)).toBe(true);
    expect(await first.save(record(), null)).toBe(false);

    const second = new DurableCleanRoomCleanupJournal(path);
    expect(await second.load(record().cleanupId)).toEqual(record());
    expect(await second.save(record(2), 0)).toBe(false);
    expect(await second.save(record(1), 0)).toBe(true);
    expect(await first.remove(record().cleanupId, 0)).toBe(false);
    expect(await second.remove(record().cleanupId, 1)).toBe(true);
    expect(await new DurableCleanRoomCleanupJournal(path).list()).toEqual([]);

    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: '1', records: [] });
  });

  it('fails closed instead of discarding malformed durable authority', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-cleanup-journal-'));
    roots.push(root);
    const path = join(root, 'cleanup.json');
    await writeFile(path, JSON.stringify({ version: '1', records: [{ cleanupId: '../escape' }] }));

    await expect(new DurableCleanRoomCleanupJournal(path).list()).rejects.toThrow('invalid record');
  });
});
