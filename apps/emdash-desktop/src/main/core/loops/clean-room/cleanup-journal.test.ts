import { describe, expect, it } from 'vitest';
import {
  createInMemoryCleanRoomCleanupJournal,
  parseCleanRoomPendingCleanup,
  type CleanRoomPendingCleanup,
} from './cleanup-journal';

const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);

function pending(overrides: Partial<CleanRoomPendingCleanup> = {}): CleanRoomPendingCleanup {
  return {
    version: '1',
    cleanupId: 'cleanup-loop-verify-fixed',
    verificationRunId: 'verification-1',
    attempt: 1,
    projectId: 'project-1',
    workspaceId: 'loop-verify-fixed',
    target: { path: '/pool/emdash/loop-verify-fixed', machine: { kind: 'local' } },
    featureTarget: {
      workspaceId: 'feature-workspace',
      path: '/feature',
      machine: { kind: 'local' },
    },
    branchName: 'emdash/loop-verify-fixed',
    baseCommit: BASE,
    expectedFeatureHead: HEAD,
    teardownRequired: true,
    completed: { teardown: false, worktree: false, branch: false },
    revision: 0,
    ...overrides,
  };
}

describe('clean-room cleanup journal', () => {
  it('uses revision CAS and returns defensive clones from load and list', async () => {
    const journal = createInMemoryCleanRoomCleanupJournal();
    const initial = pending();

    await expect(journal.save(initial, null)).resolves.toBe(true);
    await expect(journal.save({ ...initial, projectId: 'conflict' }, null)).resolves.toBe(false);

    const listed = await journal.list();
    listed[0].target.path = '/forged';
    listed[0].completed.teardown = true;
    expect(await journal.load(initial.cleanupId)).toEqual(initial);

    const progressed = {
      ...initial,
      completed: { ...initial.completed, teardown: true },
      revision: 1,
    };
    await expect(journal.save(progressed, 0)).resolves.toBe(true);
    await expect(journal.save({ ...progressed, revision: 1 }, 0)).resolves.toBe(false);
    await expect(journal.remove(initial.cleanupId, 0)).resolves.toBe(false);
    await expect(journal.remove(initial.cleanupId, 1)).resolves.toBe(true);
    await expect(journal.list()).resolves.toEqual([]);
  });

  it.each([
    ['extra field', { ...pending(), injected: true }],
    ['attempt zero', pending({ attempt: 0 })],
    [
      'oversized path',
      pending({ target: { path: `/${'x'.repeat(4_097)}`, machine: { kind: 'local' } } }),
    ],
    [
      'oversized multibyte serialization',
      pending({
        target: { path: `/${'界'.repeat(4_000)}`, machine: { kind: 'local' } },
        featureTarget: {
          workspaceId: 'feature-workspace',
          path: `/${'界'.repeat(4_000)}`,
          machine: { kind: 'local' },
        },
      }),
    ],
    ['mismatched branch', pending({ branchName: 'emdash/other' })],
    [
      'impossible progress',
      pending({ completed: { teardown: false, worktree: true, branch: false }, branchHead: BASE }),
    ],
  ])('strictly rejects %s', (_label, candidate) => {
    expect(parseCleanRoomPendingCleanup(candidate)).toMatchObject({
      success: false,
      error: { type: 'invalid-cleanup-record' },
    });
  });

  it('accepts a bounded exact record and returns a clone', () => {
    const candidate = pending();
    const parsed = parseCleanRoomPendingCleanup(candidate);

    expect(parsed).toEqual({ success: true, data: candidate });
    if (!parsed.success) throw new Error('expected parsed record');
    parsed.data.target.path = '/changed';
    expect(candidate.target.path).toBe('/pool/emdash/loop-verify-fixed');
  });

  it('parses one stable JSON snapshot instead of re-reading candidate getters', () => {
    const candidate = pending() as CleanRoomPendingCleanup & {
      target: CleanRoomPendingCleanup['target'];
    };
    let reads = 0;
    const firstTarget = candidate.target;
    Object.defineProperty(candidate, 'target', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1
          ? firstTarget
          : { path: '/forged-after-stringify', machine: { kind: 'local' } };
      },
    });

    expect(parseCleanRoomPendingCleanup(candidate)).toMatchObject({
      success: true,
      data: { target: { path: '/pool/emdash/loop-verify-fixed' } },
    });
    expect(reads).toBe(1);
  });
});
