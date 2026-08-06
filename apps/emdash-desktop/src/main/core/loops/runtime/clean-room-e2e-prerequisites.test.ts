import { describe, expect, it } from 'vitest';
import type { LoopPhase, LoopWithPhases } from '@shared/core/loops/loops';
import { priorPhasesForE2E } from './clean-room-e2e-prerequisites';

function phase(id: string, idx: number, kind: LoopPhase['kind']): LoopPhase {
  return {
    id,
    loopId: 'loop-1',
    idx,
    name: id,
    goal: id,
    kind,
    status: kind === 'e2e' ? 'pending' : 'passed',
    attempts: 1,
    conversationId: kind === 'e2e' ? null : `conversation-${id}`,
    criteria: { version: '1', criteria: [] },
    state: null,
    lastError: null,
    createdAt: '2026-08-02 04:35:50',
    updatedAt: '2026-08-02 04:35:50',
  };
}

describe('clean-room E2E prerequisite selection', () => {
  const phases = [phase('work-1', 0, 'work'), phase('review', 1, 'review'), phase('e2e', 2, 'e2e')];
  const loop = { id: 'loop-1', phases } as LoopWithPhases;

  it('returns only the contiguous prefix before the selected E2E phase', () => {
    expect(priorPhasesForE2E(loop, 'e2e')).toEqual(phases.slice(0, 2));
  });

  it('rejects a missing or non-E2E selected phase', () => {
    expect(priorPhasesForE2E(loop, 'missing')).toBeUndefined();
    expect(priorPhasesForE2E(loop, 'work-1')).toBeUndefined();
  });
});
