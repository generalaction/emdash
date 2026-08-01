import { describe, expect, it } from 'vitest';
import { loopConfig } from './loop-config';
import { loopPhaseCriteria } from './loop-phase-criteria';
import { loopPhaseState } from './loop-phase-state';
import { loopState } from './loop-state';
import {
  DEFAULT_LOOP_PROVIDER,
  LEGACY_DEFAULT_LOOP_PROVIDER,
  createLoopConfigV2,
  isLoopConfig,
  isLoopPhaseCriterion,
  isLoopStatus,
  isPhaseStatus,
  isVerifierId,
  loopPrimaryConflictSchema,
  newLoopConfigV2Schema,
  orderedLoopPhaseKinds,
  resolveLoopModel,
  resolveLoopProvider,
} from './loops';

describe('loop versioned schemas', () => {
  it('upgrades a v1 loop config without losing its historical behavior', () => {
    const result = loopConfig.safeParse({
      version: '1',
      provider: 'codex',
      verifiers: ['gh', 'agent-browser'],
      reviewEnabled: true,
      validationCommands: ['pnpm run test'],
      planSource: 'docs/plans/acp-loops.md',
      agentBrowser: {
        targetUrl: 'http://localhost:5173',
        cdpPort: 9222,
      },
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data).toEqual({
        version: '2',
        provider: 'codex',
        model: null,
        verifiers: ['gh', 'agent-browser'],
        reviewEnabled: true,
        validationCommands: ['pnpm run test'],
        planSource: 'docs/plans/acp-loops.md',
        terminalGates: { review: true, e2e: false },
        browserPreview: { enabled: true },
        agentBrowser: {
          targetUrl: 'http://localhost:5173',
          cdpPort: 9222,
        },
      });
    }
  });

  it('materializes the historical Claude default without inventing a model', () => {
    const result = loopConfig.safeParse({
      version: '1',
      verifiers: ['gh'],
      reviewEnabled: false,
      validationCommands: [],
      planSource: 'phase plan',
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(resolveLoopProvider(result.data)).toBe(LEGACY_DEFAULT_LOOP_PROVIDER);
      expect(resolveLoopModel(result.data)).toBeNull();
      expect(result.data).toMatchObject({
        version: '2',
        provider: 'claude',
        model: null,
        terminalGates: { review: false, e2e: false },
        browserPreview: { enabled: false },
      });
    }
    expect(resolveLoopProvider(null)).toBe(LEGACY_DEFAULT_LOOP_PROVIDER);
    expect(resolveLoopProvider(undefined)).toBe(LEGACY_DEFAULT_LOOP_PROVIDER);
  });

  it('preserves an explicit historical Claude provider', () => {
    const result = loopConfig.safeParse({
      version: '1',
      provider: 'claude',
      verifiers: [],
      reviewEnabled: true,
      validationCommands: [],
      planSource: 'phase plan',
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(resolveLoopProvider(result.data)).toBe('claude');
      expect(resolveLoopModel(result.data)).toBeNull();
    }
  });

  it('creates strict v2 configs with the preflighted Codex provider/model pair', () => {
    const config = createLoopConfigV2({
      model: 'gpt-5.6-sol',
      validationCommands: ['pnpm run test'],
      planSource: 'phase plan',
      terminalGates: { review: true, e2e: true },
      browserPreview: { enabled: true },
    });

    expect(DEFAULT_LOOP_PROVIDER).toBe('codex');
    expect(config).toMatchObject({
      version: '2',
      provider: 'codex',
      model: 'gpt-5.6-sol',
      terminalGates: { review: true, e2e: true },
      browserPreview: { enabled: true },
    });
    expect(resolveLoopProvider(config)).toBe('codex');
    expect(resolveLoopModel(config)).toBe('gpt-5.6-sol');
    expect(
      newLoopConfigV2Schema.safeParse({ ...config, provider: 'claude', model: null }).success
    ).toBe(false);
    expect(() => createLoopConfigV2({ ...config, model: '   ' })).toThrow();
  });

  it('round-trips a v1 loop config through serialize and parseJson', () => {
    const config = loopConfig.safeParse({
      version: '1',
      provider: 'claude',
      verifiers: ['vercel', 'convex'],
      reviewEnabled: false,
      validationCommands: ['pnpm run typecheck', 'pnpm run lint'],
      planSource: 'phase plan',
    });

    expect(config.status).toBe('ok');
    if (config.status === 'ok') {
      const json = loopConfig.serialize(config.data);
      expect(loopConfig.parseJson(json)).toEqual(config.data);
    }
  });

  it('rejects invalid verifier ids in loop config', () => {
    const result = loopConfig.safeParse({
      version: '1',
      provider: 'codex',
      verifiers: ['unknown'],
      reviewEnabled: false,
      validationCommands: [],
      planSource: 'phase plan',
    });

    expect(result.status).toBe('invalid');
  });

  it('parses v1 loop phase criteria', () => {
    const result = loopPhaseCriteria.safeParse({
      version: '1',
      criteria: [
        {
          description: 'CI is green',
          verifier: 'gh',
          status: 'pending',
        },
        {
          description: 'Preview renders the new page',
          verifier: 'agent-browser',
          status: 'passed',
          evidence: '.emdash-loops-evidence/phase-1.png',
        },
      ],
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.criteria).toHaveLength(2);
      expect(result.data.criteria[1]?.evidence).toBe('.emdash-loops-evidence/phase-1.png');
    }
  });

  it('round-trips v1 loop phase criteria through serialize and parseJson', () => {
    const criteria = loopPhaseCriteria.safeParse({
      version: '1',
      criteria: [
        {
          description: 'Deployment is ready',
          verifier: 'vercel',
          status: 'verifying',
        },
      ],
    });

    expect(criteria.status).toBe('ok');
    if (criteria.status === 'ok') {
      const json = loopPhaseCriteria.serialize(criteria.data);
      expect(loopPhaseCriteria.parseJson(json)).toEqual(criteria.data);
    }
  });

  it('returns null for invalid criteria JSON', () => {
    expect(loopPhaseCriteria.parseJson('not-json')).toBeNull();
  });

  it('parses resumable loop runtime and phase handoff state', () => {
    const target = {
      workspaceId: 'workspace-verification-1',
      path: '/tmp/verification-worktree',
      machine: { kind: 'ssh' as const, connectionId: 'ssh-1' },
    };
    const runtime = loopState.safeParse({
      version: '1',
      baseCommit: '1'.repeat(40),
      expectedFeatureHead: '2'.repeat(40),
      checkpointCommit: '3'.repeat(40),
      sessionAttempts: [
        {
          attemptId: 'attempt-1',
          conversationId: 'conversation-1',
          purpose: 'e2e',
          target,
          status: 'running',
          startedAt: '2026-07-11T12:00:00.000Z',
        },
      ],
      verification: {
        verificationRunId: 'verification-1',
        attempt: 1,
        status: 'running',
        target,
        baseCommit: '1'.repeat(40),
        replayedThroughCommit: '3'.repeat(40),
        expectedFeatureHead: '2'.repeat(40),
        cleanup: { status: 'pending', updatedAt: '2026-07-11T12:00:00.000Z' },
      },
    });
    const phase = loopPhaseState.safeParse({
      version: '1',
      checkpointCommit: '3'.repeat(40),
      handoff: {
        summary: 'Implemented the schema contract.',
        risks: ['Migration requires deterministic primary selection.'],
        remainingWork: ['Wire the runtime in a later lane.'],
        artifacts: [
          {
            artifactId: 'artifact-1',
            kind: 'test-report',
            byteLength: 1200,
            createdAt: '2026-07-11T12:10:00.000Z',
          },
        ],
        createdAt: '2026-07-11T12:10:00.000Z',
      },
      result: {
        status: 'passed',
        summary: 'Focused tests passed.',
        completedAt: '2026-07-11T12:11:00.000Z',
      },
    });

    expect(runtime.status).toBe('ok');
    expect(phase.status).toBe('ok');
  });
});

describe('loop v2 ordering and primary contracts', () => {
  it.each([
    [{ review: false, e2e: false }, ['work', 'work']],
    [{ review: true, e2e: false }, ['work', 'work', 'review']],
    [{ review: false, e2e: true }, ['work', 'work', 'e2e']],
    [{ review: true, e2e: true }, ['work', 'work', 'review', 'e2e']],
  ] as const)('orders terminal gates after work phases for %o', (terminalGates, expected) => {
    expect(orderedLoopPhaseKinds(2, terminalGates)).toEqual(expected);
  });

  it('exposes a typed concurrent primary-loop creation conflict', () => {
    expect(
      loopPrimaryConflictSchema.parse({
        kind: 'primary-loop-exists',
        taskId: 'task-1',
        existingLoopId: 'loop-1',
      })
    ).toEqual({
      kind: 'primary-loop-exists',
      taskId: 'task-1',
      existingLoopId: 'loop-1',
    });
  });
});

describe('loop type guards', () => {
  it('identifies loop statuses', () => {
    expect(isLoopStatus('draft')).toBe(true);
    expect(isLoopStatus('running')).toBe(true);
    expect(isLoopStatus('done')).toBe(false);
  });

  it('identifies phase statuses', () => {
    expect(isPhaseStatus('reviewing')).toBe(true);
    expect(isPhaseStatus('completed')).toBe(false);
  });

  it('identifies verifier ids', () => {
    expect(isVerifierId('agent-browser')).toBe(true);
    expect(isVerifierId('unit-tests')).toBe(false);
  });

  it('identifies loop configs', () => {
    expect(
      isLoopConfig({
        version: '1',
        verifiers: ['gh'],
        reviewEnabled: false,
        validationCommands: [],
        planSource: 'phase plan',
      })
    ).toBe(true);
    expect(isLoopConfig({ version: '1', verifiers: ['invalid'] })).toBe(false);
  });

  it('identifies loop phase criteria', () => {
    expect(
      isLoopPhaseCriterion({
        description: 'Convex schema validates',
        verifier: 'convex',
        status: 'passed',
        evidence: 'stdout',
      })
    ).toBe(true);
    expect(isLoopPhaseCriterion({ description: 'Missing verifier', status: 'passed' })).toBe(false);
  });
});
