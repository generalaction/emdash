import type { LoopPhaseInsert, LoopPhaseRow, LoopRow } from '@main/db/schema';
import type { Loop, LoopPhase, LoopStatus, PhaseStatus } from '@shared/core/loops/loops';

export type LoopOperationError =
  | { kind: 'invalid-input'; message: string }
  | { kind: 'not-found'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'db-error'; message: string };

export type LoopPhasePatch = Partial<
  Pick<LoopPhaseInsert, 'status' | 'attempts' | 'conversationId' | 'criteria' | 'lastError'>
>;

export type LoopPatch = {
  status?: LoopStatus;
  currentPhaseIndex?: number;
};

export type LoopPhaseTransition = {
  phaseId: string;
  status?: PhaseStatus;
  attempts?: number;
  conversationId?: string | null;
  criteria?: LoopPhase['criteria'];
  lastError?: string | null;
};

export function mapLoopRow(row: LoopRow): Loop {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    name: row.name,
    slug: row.slug,
    status: row.status,
    currentPhaseIndex: row.currentPhaseIndex,
    config: row.config,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapLoopPhaseRow(row: LoopPhaseRow): LoopPhase {
  return {
    id: row.id,
    loopId: row.loopId,
    idx: row.idx,
    name: row.name,
    goal: row.goal,
    status: row.status,
    attempts: row.attempts,
    conversationId: row.conversationId,
    criteria: row.criteria,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
