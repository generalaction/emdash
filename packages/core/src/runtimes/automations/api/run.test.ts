import { LOCAL_HOST_REF } from '@primitives/host/api';
import { describe, expect, it } from 'vitest';
import { automationRunSchema } from './run';

const workspace = {
  host: LOCAL_HOST_REF,
  path: { root: { kind: 'posix' as const }, segments: ['worktrees', 'emdash-abc'] },
};

const configSnapshot = {
  name: 'Nightly',
  schedule: { expr: '0 9 * * *', tz: 'UTC' },
  agent: {
    type: 'acp' as const,
    start: {
      providerId: 'claude',
      model: null,
      initialQueue: [{ text: 'Review open PRs' }],
    },
  },
  workspace: {
    kind: 'worktree' as const,
    repository: {
      host: LOCAL_HOST_REF,
      path: { root: { kind: 'posix' as const }, segments: ['repo'] },
    },
    preservePatterns: ['.env*'],
    git: {
      kind: 'create-branch' as const,
      fromBranch: { type: 'local' as const, branch: 'main' },
      pushRemote: null,
    },
  },
};

const scheduledRun = {
  id: 'run-1',
  seq: 1,
  automationId: 'auto-1',
  status: 'scheduled',
  triggerKind: 'cron',
  configSnapshot,
  generatedName: 'emdash-abc',
  scheduledAt: 1_000,
  deadlineAt: 2_000,
  startedAt: null,
  finishedAt: null,
  workspace: null,
  branchName: null,
  conversationId: null,
  sessionId: null,
  error: null,
};

describe('automationRunSchema', () => {
  it('normalizes generated and provider-owned identifiers', () => {
    const parsed = automationRunSchema.parse({
      ...scheduledRun,
      status: 'done',
      generatedName: '  emdash-abc  ',
      startedAt: 1_100,
      finishedAt: 1_200,
      workspace,
      branchName: '  emdash-abc  ',
      conversationId: '  conversation-1  ',
      sessionId: '  session-1  ',
    });

    expect(parsed).toMatchObject({
      generatedName: 'emdash-abc',
      branchName: 'emdash-abc',
      conversationId: 'conversation-1',
      sessionId: 'session-1',
    });
  });

  it('rejects negative timestamps', () => {
    for (const field of ['scheduledAt', 'deadlineAt', 'startedAt', 'finishedAt']) {
      expect(automationRunSchema.safeParse({ ...scheduledRun, [field]: -1 }).success).toBe(false);
    }
  });
});
