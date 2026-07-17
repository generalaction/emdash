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
  workspace: {
    kind: 'worktree' as const,
    repository,
    preservePatterns: ['.env*'],
    git: {
      kind: 'create-branch' as const,
      fromBranch: { type: 'local' as const, branch: 'main' },
      pushRemote: 'fork',
    },
  },
  revision: 1,
};

describe('automation deployment schemas', () => {
  it('validates a deployment and derives its immutable run snapshot', () => {
    const parsed = automationDeploymentSchema.parse(deployment);
    const snapshot = automationRunConfigSnapshotSchema.parse(parsed);

    expect(parsed.automationId).toBe('auto-1');
    expect(snapshot).not.toHaveProperty('automationId');
    expect(snapshot).not.toHaveProperty('enabled');
    expect(snapshot).not.toHaveProperty('revision');
    expect(snapshot.workspace).toEqual(deployment.workspace);
  });

  it('accepts structurally valid schedules without evaluating cron semantics', () => {
    expect(
      automationDeploymentSchema.safeParse({
        ...deployment,
        schedule: { expr: '0 9 * *', tz: deployment.schedule.tz },
      }).success
    ).toBe(true);
    expect(
      automationDeploymentSchema.safeParse({
        ...deployment,
        schedule: { expr: deployment.schedule.expr, tz: 'Not/A_Timezone' },
      }).success
    ).toBe(true);
  });

  it('rejects blank schedule fields without a local fallback', () => {
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        schedule: { ...deployment.schedule, expr: '   ' },
      })
    ).toThrow();
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        schedule: { ...deployment.schedule, tz: '' },
      })
    ).toThrow();
  });

  it('accepts fixed-directory deployments without repository or git fields', () => {
    const parsed = automationDeploymentSchema.parse({
      ...deployment,
      workspace: { kind: 'directory', path: repository },
    });

    expect(parsed.workspace).toEqual({ kind: 'directory', path: repository });
  });

  it('requires repository and git configuration for a worktree', () => {
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        workspace: { kind: 'worktree', repository, preservePatterns: [] },
      })
    ).toThrow();
  });

  it('requires explicit non-blank preserve patterns for worktrees', () => {
    const { preservePatterns: _preservePatterns, ...withoutPreservePatterns } =
      deployment.workspace;

    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        workspace: withoutPreservePatterns,
      })
    ).toThrow();
    expect(() =>
      automationDeploymentSchema.parse({
        ...deployment,
        workspace: { ...deployment.workspace, preservePatterns: ['   '] },
      })
    ).toThrow();

    const parsed = automationDeploymentSchema.parse({
      ...deployment,
      workspace: { ...deployment.workspace, preservePatterns: [] },
    });
    expect(parsed.workspace).toMatchObject({ preservePatterns: [] });
  });

  it('trims user-entered deployment and runtime input strings', () => {
    const parsed = automationDeploymentSchema.parse({
      ...deployment,
      name: '  Nightly review  ',
      agent: {
        type: 'acp',
        title: '  Review result  ',
        start: {
          providerId: '  claude  ',
          model: '  opus  ',
          modeId: '  agent  ',
          initialQueue: [{ text: '  Review open PRs  ', hiddenContext: '  keep spacing  ' }],
        },
      },
      workspace: {
        ...deployment.workspace,
        preservePatterns: ['  .env*  '],
        git: {
          kind: 'create-branch',
          fromBranch: {
            type: 'remote',
            branch: '  main  ',
            remote: { name: '  origin  ', url: '  git@example.com:org/repo.git  ' },
          },
          pushRemote: '  fork  ',
        },
      },
    });

    expect(parsed).toMatchObject({
      name: 'Nightly review',
      agent: {
        title: 'Review result',
        start: {
          providerId: 'claude',
          model: 'opus',
          modeId: 'agent',
          initialQueue: [{ text: 'Review open PRs', hiddenContext: '  keep spacing  ' }],
        },
      },
      workspace: {
        preservePatterns: ['.env*'],
        git: {
          fromBranch: {
            branch: 'main',
            remote: { name: 'origin', url: 'git@example.com:org/repo.git' },
          },
          pushRemote: 'fork',
        },
      },
    });
  });

  it('rejects blank prompts, providers, models, modes, titles, and names', () => {
    const invalidDeployments = [
      { ...deployment, name: '   ' },
      {
        ...deployment,
        agent: {
          ...deployment.agent,
          start: { ...deployment.agent.start, providerId: '   ' },
        },
      },
      {
        ...deployment,
        agent: {
          ...deployment.agent,
          start: { ...deployment.agent.start, model: '' },
        },
      },
      {
        ...deployment,
        agent: {
          ...deployment.agent,
          start: { ...deployment.agent.start, modeId: '   ' },
        },
      },
      { ...deployment, agent: { ...deployment.agent, title: '   ' } },
      {
        ...deployment,
        agent: {
          ...deployment.agent,
          start: { ...deployment.agent.start, initialQueue: [{ text: '   ' }] },
        },
      },
    ];

    for (const invalid of invalidDeployments) {
      expect(automationDeploymentSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('rejects blank TUI models and prompts while accepting null as provider default', () => {
    const tuiAgent = {
      type: 'tui' as const,
      start: {
        providerId: 'codex',
        model: null,
        initialPrompt: 'Review open PRs',
        autoApprove: false,
      },
    };

    expect(automationDeploymentSchema.safeParse({ ...deployment, agent: tuiAgent }).success).toBe(
      true
    );
    expect(
      automationDeploymentSchema.safeParse({
        ...deployment,
        agent: { ...tuiAgent, start: { ...tuiAgent.start, model: '   ' } },
      }).success
    ).toBe(false);
    expect(
      automationDeploymentSchema.safeParse({
        ...deployment,
        agent: { ...tuiAgent, start: { ...tuiAgent.start, initialPrompt: '   ' } },
      }).success
    ).toBe(false);
  });
});
