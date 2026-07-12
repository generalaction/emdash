import { describe, expect, it } from 'vitest';
import {
  loopPhaseState,
  loopPhaseStateInputSchema,
  loopPhaseStateV2Schema,
  type LoopPhaseRetryHandoff,
} from './loop-phase-state';

const CHECKPOINT = 'a'.repeat(40);

const retryHandoff: LoopPhaseRetryHandoff = {
  source: 'Clean-room E2E attempt 1',
  handoff: {
    summary: 'The required check found a retryable defect.',
    risks: ['The correction still needs an independent replay.'],
    remainingWork: ['Recreate the clean room and rerun the checks.'],
    artifacts: [],
    createdAt: '2026-07-12T20:00:00.000Z',
  },
};

describe('Loop phase state v2', () => {
  it('upgrades v1 phase state with an empty durable retry ledger', () => {
    const result = loopPhaseState.safeParse({
      version: '1',
      checkpointCommit: CHECKPOINT,
      handoff: null,
      result: null,
    });

    expect(result).toEqual({
      status: 'ok',
      data: {
        version: '2',
        checkpointCommit: CHECKPOINT,
        handoff: null,
        retryHandoffs: [],
        result: null,
      },
    });
    expect(
      loopPhaseStateInputSchema.parse({
        version: '1',
        checkpointCommit: CHECKPOINT,
        handoff: null,
        result: null,
      })
    ).toMatchObject({ version: '2', retryHandoffs: [] });
  });

  it('keeps the retry ledger strict and bounded to 64 handoffs', () => {
    const state = {
      version: '2' as const,
      checkpointCommit: CHECKPOINT,
      handoff: null,
      retryHandoffs: Array.from({ length: 64 }, () => retryHandoff),
      result: null,
    };

    expect(loopPhaseStateV2Schema.safeParse(state).success).toBe(true);
    expect(
      loopPhaseStateV2Schema.safeParse({
        ...state,
        retryHandoffs: [...state.retryHandoffs, retryHandoff],
      }).success
    ).toBe(false);
    expect(loopPhaseStateV2Schema.safeParse({ ...state, unexpected: true }).success).toBe(false);
    expect(
      loopPhaseStateV2Schema.safeParse({
        ...state,
        retryHandoffs: [{ ...retryHandoff, source: 'x'.repeat(257) }],
      }).success
    ).toBe(false);
  });
});
