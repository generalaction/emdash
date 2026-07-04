import { describe, expect, it } from 'vitest';
import type { LoopVerifierAvailability } from '@shared/core/loops/loops';
import { buildCreateLoopParams, validationError, type DraftPhase } from './create-loop-form-model';

const availability: LoopVerifierAvailability[] = [
  { id: 'gh', label: 'GitHub checks', available: true },
  { id: 'agent-browser', label: 'Agent Browser', available: true },
];

function phase(verifier: 'gh' | 'agent-browser'): DraftPhase {
  return {
    id: 'phase-1',
    name: 'Phase 1',
    goal: 'Ship it',
    criteria: [
      {
        id: 'criterion-1',
        description: 'Criterion is met',
        verifier,
      },
    ],
  };
}

describe('create loop form model', () => {
  it('persists Agent Browser target config when the verifier is selected', () => {
    const params = buildCreateLoopParams({
      projectId: 'project-1',
      taskId: 'task-1',
      name: ' Browser loop ',
      planSource: 'manual',
      validationCommands: [' pnpm run test ', ''],
      selectedVerifiers: new Set(['agent-browser']),
      reviewEnabled: true,
      phases: [phase('agent-browser')],
      agentBrowser: {
        targetUrl: ' http://localhost:5173 ',
        cdpPort: ' 9222 ',
      },
    });

    expect(params).toMatchObject({
      name: 'Browser loop',
      validationCommands: ['pnpm run test'],
      verifiers: ['agent-browser'],
      reviewEnabled: true,
      agentBrowser: {
        targetUrl: 'http://localhost:5173',
        cdpPort: 9222,
      },
    });
  });

  it('omits Agent Browser config when the verifier is not selected', () => {
    const params = buildCreateLoopParams({
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Loop',
      provider: 'codex',
      planSource: 'manual',
      validationCommands: ['pnpm run test'],
      selectedVerifiers: new Set(['gh']),
      reviewEnabled: false,
      phases: [phase('gh')],
      agentBrowser: {
        targetUrl: 'http://localhost:5173',
        cdpPort: '9222',
      },
    });

    expect(params.agentBrowser).toBeUndefined();
    expect(params.provider).toBe('codex');
  });

  it('keeps an empty Agent Browser config object when selected without optional inputs', () => {
    const params = buildCreateLoopParams({
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Loop',
      planSource: 'manual',
      validationCommands: ['pnpm run test'],
      selectedVerifiers: new Set(['agent-browser']),
      reviewEnabled: false,
      phases: [phase('agent-browser')],
      agentBrowser: {
        targetUrl: '',
        cdpPort: '',
      },
    });

    expect(params.agentBrowser).toEqual({});
  });

  it('rejects invalid CDP ports when Agent Browser is selected', () => {
    expect(
      validationError({
        name: 'Loop',
        phases: [phase('agent-browser')],
        validationCommands: ['pnpm run test'],
        selectedVerifiers: new Set(['agent-browser']),
        availability,
        agentBrowser: {
          targetUrl: '',
          cdpPort: 'not-a-port',
        },
      })
    ).toBe('CDP port must be a positive integer.');
  });
});
