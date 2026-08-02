import type { LoopPhase, LoopWithPhases } from '@shared/core/loops/loops';

export function priorPhasesForE2E(
  loop: LoopWithPhases | null | undefined,
  phaseId: string
): LoopPhase[] | undefined {
  const phase = loop?.phases.find((candidate) => candidate.id === phaseId);
  if (!loop || phase?.kind !== 'e2e') return undefined;
  return loop.phases.filter((candidate) => candidate.idx < phase.idx);
}
