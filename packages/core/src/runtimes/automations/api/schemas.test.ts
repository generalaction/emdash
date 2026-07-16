import { LOCAL_HOST_REF } from '@primitives/host/api';
import { describe, expect, it } from 'vitest';
import { automationDeploymentSchema } from './deployment';
import { automationRunSchema } from './run';
import {
  GET_RUNS_DEFAULT_LIMIT,
  GET_RUNS_MAX_LIMIT,
  deployInputSchema,
  getRunsInputSchema,
  runEventsKeySchema,
} from './schemas';

const repository = {
  host: LOCAL_HOST_REF,
  path: {
    root: { kind: 'posix' as const },
    segments: ['Users', 'jona', 'repo'],
  },
};

const deployment = {
  automationId: 'auto-1',
  enabled: true,
  name: 'Nightly',
  schedule: { expr: '0 9 * * *', tz: 'America/Los_Angeles' },
  agent: {
    type: 'acp' as const,
    providerId: 'claude',
    prompt: 'Review open PRs',
    model: null,
    autoApprove: true,
  },
  repository,
  git: {
    kind: 'create-branch' as const,
    fromBranch: { type: 'local' as const, branch: 'main' },
    pushBranch: true,
  },
  workspace: { kind: 'worktree' as const },
  updatedAt: 1_700_000_000_000,
};

const runConfigSnapshot = {
  name: deployment.name,
  schedule: deployment.schedule,
  agent: deployment.agent,
  repository: deployment.repository,
  git: deployment.git,
  workspace: deployment.workspace,
};

describe('automations deployment schema', () => {
  it('requires a timezone on cron schedules', () => {
    expect(deployInputSchema.parse(deployment)).toMatchObject({
      automationId: 'auto-1',
      schedule: { tz: 'America/Los_Angeles' },
    });
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        schedule: { expr: '0 9 * * *' },
      })
    ).toThrow();
  });

  it('rejects empty automation ids and prompts', () => {
    expect(() => automationDeploymentSchema.parse({ ...deployment, automationId: '' })).toThrow();
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        agent: { ...deployment.agent, prompt: '' },
      })
    ).toThrow();
  });

  it('supports local repositories without a remote and preserves the push choice', () => {
    expect(
      automationDeploymentSchema.parse({
        ...deployment,
        git: { ...deployment.git, pushBranch: false },
      }).git
    ).toEqual({
      kind: 'create-branch',
      fromBranch: { type: 'local', branch: 'main' },
      pushBranch: false,
    });
  });

  it('accepts use-branch with a plain branch name in a fresh worktree', () => {
    expect(
      automationDeploymentSchema.parse({
        ...deployment,
        git: { kind: 'use-branch', branchName: 'release/1.2' },
      }).git
    ).toEqual({ kind: 'use-branch', branchName: 'release/1.2' });
  });

  it('accepts a fixed-directory target with git none', () => {
    const parsed = automationDeploymentSchema.parse({
      ...deployment,
      git: { kind: 'none' },
      workspace: { kind: 'directory', path: repository },
    });
    expect(parsed.workspace).toEqual({ kind: 'directory', path: repository });
  });

  it('rejects worktree targets without a branch intent and directory targets with one', () => {
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        git: { kind: 'none' },
        workspace: { kind: 'worktree' },
      })
    ).toThrow();
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        workspace: { kind: 'directory', path: repository },
      })
    ).toThrow();
  });
});

describe('automations run schema', () => {
  it('requires positive seq, a config snapshot, and nullable host artifacts', () => {
    const run = automationRunSchema.parse({
      id: 'run-1',
      seq: 1,
      automationId: 'auto-1',
      status: 'done',
      triggerKind: 'cron',
      configSnapshot: runConfigSnapshot,
      generatedName: 'emdash-abc',
      scheduledAt: 1,
      deadlineAt: null,
      startedAt: 2,
      finishedAt: 3,
      worktree: {
        host: LOCAL_HOST_REF,
        path: { root: { kind: 'posix' }, segments: ['tmp', 'wt-1'] },
      },
      branchName: 'emdash-abc',
      conversationId: 'conv-1',
      sessionId: 'sess-1',
      error: null,
    });
    expect(run.seq).toBe(1);
    expect(run.configSnapshot.agent.providerId).toBe('claude');
    expect(run.worktree?.path.segments).toEqual(['tmp', 'wt-1']);
    expect(() => automationRunSchema.parse({ ...run, seq: 0 })).toThrow();
    expect(() => automationRunSchema.parse({ ...run, generatedName: '' })).toThrow();
  });
});

describe('automations procedure io', () => {
  it('bounds getRuns pages and requires at least one automation id', () => {
    expect(GET_RUNS_DEFAULT_LIMIT).toBe(200);
    expect(getRunsInputSchema.parse({ sinceSeq: 0, automationIds: ['auto-1'] })).toEqual({
      sinceSeq: 0,
      automationIds: ['auto-1'],
    });
    expect(() => getRunsInputSchema.parse({ sinceSeq: 0, automationIds: [] })).toThrow();
    expect(() =>
      getRunsInputSchema.parse({
        sinceSeq: 0,
        automationIds: ['auto-1'],
        limit: GET_RUNS_MAX_LIMIT + 1,
      })
    ).toThrow();
  });

  it('requires at least one automation id for run event subscriptions', () => {
    expect(runEventsKeySchema.parse({ automationIds: ['auto-1'] })).toEqual({
      automationIds: ['auto-1'],
    });
    expect(() => runEventsKeySchema.parse({ automationIds: [] })).toThrow();
  });
});
