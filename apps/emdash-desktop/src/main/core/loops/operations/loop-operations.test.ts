import { describe, expect, it, vi } from 'vitest';
import { prepareNewLoop } from './loop-operations';

vi.mock('@main/db/client', () => ({ db: {} }));

const baseInput = {
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Ship Loops',
  model: 'gpt-5.6-sol',
  planSource: '# Implement',
  validationCommands: ['pnpm run test'],
  terminalGates: { review: false, e2e: false },
  browserPreview: { enabled: false },
  workPhases: [{ name: 'Implement', goal: 'Build the feature.' }],
  acceptanceCriteria: [],
};

describe('prepareNewLoop', () => {
  it.each([
    [{ review: false, e2e: false }, ['work']],
    [{ review: true, e2e: false }, ['work', 'review']],
    [{ review: false, e2e: true }, ['work', 'e2e']],
    [{ review: true, e2e: true }, ['work', 'review', 'e2e']],
  ] as const)('builds fixed terminal order for %j', (terminalGates, kinds) => {
    const result = prepareNewLoop({
      ...baseInput,
      terminalGates,
      browserPreview: { enabled: terminalGates.e2e },
      acceptanceCriteria: terminalGates.e2e ? ['The native preview works.'] : [],
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.phases.map((phase) => phase.kind)).toEqual(kinds);
  });

  it('creates canonical v2 config, state, phase state, and native criteria', () => {
    const result = prepareNewLoop({
      ...baseInput,
      terminalGates: { review: true, e2e: true },
      browserPreview: { enabled: true },
      acceptanceCriteria: [' The native dialog saves. '],
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        config: {
          version: '2',
          provider: 'codex',
          model: 'gpt-5.6-sol',
          validationCommands: ['pnpm run test'],
          terminalGates: { review: true, e2e: true },
          browserPreview: { enabled: true },
        },
        state: {
          version: '2',
          e2eAttemptsConsumed: 0,
          sessionAttempts: [],
          verification: null,
        },
        phases: [
          { kind: 'work', state: { version: '2', retryHandoffs: [], result: null } },
          { kind: 'review', state: { version: '2', retryHandoffs: [], result: null } },
          {
            kind: 'e2e',
            criteria: {
              criteria: [
                {
                  description: 'The native dialog saves.',
                  verifier: 'agent-browser',
                  status: 'pending',
                },
              ],
            },
          },
        ],
      },
    });
  });

  it.each([
    ['empty validation commands', { validationCommands: ['  '] }],
    [
      'missing E2E acceptance criteria',
      {
        terminalGates: { review: false, e2e: true },
        browserPreview: { enabled: true },
        acceptanceCriteria: [],
      },
    ],
    [
      'browser-preview drift',
      {
        terminalGates: { review: false, e2e: true },
        browserPreview: { enabled: false },
        acceptanceCriteria: ['The native preview works.'],
      },
    ],
  ] as const)('rejects %s', (_name, patch) => {
    const result = prepareNewLoop({ ...baseInput, ...patch });

    expect(result).toMatchObject({ success: false, error: { kind: 'invalid-input' } });
  });
});
