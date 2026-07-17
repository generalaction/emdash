import { LOCAL_HOST_REF } from '@primitives/host/api';
import { describe, expect, it } from 'vitest';
import { automationDeploymentSchema, automationRunConfigSnapshotSchema } from './deployment';

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
    start: {
      providerId: 'claude',
      model: null,
      initialQueue: [{ text: 'Review open PRs' }],
    },
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

describe('automation deployment schemas', () => {
  it('validates a deployment and derives its immutable run snapshot', () => {
    const parsed = automationDeploymentSchema.parse(deployment);
    const snapshot = automationRunConfigSnapshotSchema.parse(parsed);

    expect(parsed.automationId).toBe('auto-1');
    expect(snapshot).not.toHaveProperty('automationId');
    expect(snapshot).not.toHaveProperty('enabled');
    expect(snapshot).not.toHaveProperty('updatedAt');
  });

  it('rejects invalid cron expressions', () => {
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        schedule: { ...deployment.schedule, expr: '0 9 * *' },
      })
    ).toThrow();
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        schedule: { ...deployment.schedule, expr: 'not a cron expression' },
      })
    ).toThrow();
  });

  it('rejects invalid and missing schedule timezones without a local fallback', () => {
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        schedule: { ...deployment.schedule, tz: 'Not/A_Timezone' },
      })
    ).toThrow();
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        schedule: { ...deployment.schedule, tz: '' },
      })
    ).toThrow();
  });

  it('enforces compatible workspace and git intents', () => {
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        git: { kind: 'none' },
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
