import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { loopPhases, loops } from '@main/db/schema';
import { err, ok, type Result } from '@main/lib/result';
import type {
  LoopPhaseHandoff,
  LoopPhaseState,
  LoopStageResult,
} from '@shared/core/loops/loop-phase-state';
import type { LoopSessionAttempt, LoopStateV2 } from '@shared/core/loops/loop-state';
import type { LoopPhase, LoopWithPhases } from '@shared/core/loops/loops';
import { getLoop } from './loop-operations';
import type { LoopOperationError } from './types';

export async function commitTerminalPhaseSuccess(input: {
  loopId: string;
  phaseId: string;
  expectedLoopState: LoopStateV2;
  expectedPhaseState: LoopPhaseState;
  checkpointCommit: string;
  handoff: LoopPhaseHandoff | null;
  result: LoopStageResult;
  sessionAttempts: readonly LoopSessionAttempt[];
}): Promise<Result<{ loop: LoopWithPhases; phase: LoopPhase }, LoopOperationError>> {
  try {
    let conflict = false;
    db.transaction((tx) => {
      const [loopRow] = tx.select().from(loops).where(eq(loops.id, input.loopId)).limit(1).all();
      const [phaseRow] = tx
        .select()
        .from(loopPhases)
        .where(and(eq(loopPhases.id, input.phaseId), eq(loopPhases.loopId, input.loopId)))
        .limit(1)
        .all();
      if (
        !loopRow ||
        !phaseRow ||
        !isDeepStrictEqual(loopRow.state, input.expectedLoopState) ||
        !isDeepStrictEqual(phaseRow.state, input.expectedPhaseState)
      ) {
        conflict = true;
        return;
      }
      tx.update(loops)
        .set({
          state: {
            ...input.expectedLoopState,
            expectedFeatureHead: input.checkpointCommit,
            checkpointCommit: input.checkpointCommit,
            sessionAttempts: [...input.sessionAttempts],
          },
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(loops.id, input.loopId))
        .run();
      tx.update(loopPhases)
        .set({
          status: 'passed',
          state: {
            ...input.expectedPhaseState,
            checkpointCommit: input.checkpointCommit,
            handoff: input.handoff,
            result: input.result,
          },
          lastError: null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(loopPhases.id, input.phaseId))
        .run();
    });
    if (conflict) {
      return err({ kind: 'conflict', message: 'Terminal phase progress changed concurrently' });
    }
    const loop = await getLoop(input.loopId);
    const phase = loop?.phases.find((candidate) => candidate.id === input.phaseId);
    if (!loop || !phase) return err({ kind: 'not-found', message: 'Terminal phase not found' });
    return ok({ loop, phase });
  } catch (error) {
    return err({
      kind: 'db-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function commitTerminalPhaseFailure(input: {
  loopId: string;
  phaseId: string;
  expectedLoopState: LoopStateV2;
  expectedPhaseState: LoopPhaseState;
  checkpointCommit: string;
  result: LoopStageResult;
  sessionAttempts: readonly LoopSessionAttempt[];
  lastError: string;
}): Promise<Result<{ loop: LoopWithPhases; phase: LoopPhase }, LoopOperationError>> {
  try {
    let conflict = false;
    db.transaction((tx) => {
      const [loopRow] = tx.select().from(loops).where(eq(loops.id, input.loopId)).limit(1).all();
      const [phaseRow] = tx
        .select()
        .from(loopPhases)
        .where(and(eq(loopPhases.id, input.phaseId), eq(loopPhases.loopId, input.loopId)))
        .limit(1)
        .all();
      if (
        !loopRow ||
        !phaseRow ||
        !isDeepStrictEqual(loopRow.state, input.expectedLoopState) ||
        !isDeepStrictEqual(phaseRow.state, input.expectedPhaseState)
      ) {
        conflict = true;
        return;
      }
      tx.update(loops)
        .set({
          status: 'failed',
          state: {
            ...input.expectedLoopState,
            expectedFeatureHead: input.checkpointCommit,
            checkpointCommit: input.checkpointCommit,
            sessionAttempts: [...input.sessionAttempts],
          },
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(loops.id, input.loopId))
        .run();
      tx.update(loopPhases)
        .set({
          status: 'failed',
          state: {
            ...input.expectedPhaseState,
            checkpointCommit: input.checkpointCommit,
            result: input.result,
          },
          lastError: input.lastError,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(loopPhases.id, input.phaseId))
        .run();
    });
    if (conflict) {
      return err({ kind: 'conflict', message: 'Terminal phase failure changed concurrently' });
    }
    const loop = await getLoop(input.loopId);
    const phase = loop?.phases.find((candidate) => candidate.id === input.phaseId);
    if (!loop || !phase) return err({ kind: 'not-found', message: 'Terminal phase not found' });
    return ok({ loop, phase });
  } catch (error) {
    return err({
      kind: 'db-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function adoptTerminalCorrectionForRetry(input: {
  loopId: string;
  phaseId: string;
  expectedLoopState: LoopStateV2;
  expectedPhaseState: LoopPhaseState;
  checkpointCommit: string;
}): Promise<Result<{ loop: LoopWithPhases; phase: LoopPhase }, LoopOperationError>> {
  try {
    let conflict = false;
    db.transaction((tx) => {
      const [loopRow] = tx.select().from(loops).where(eq(loops.id, input.loopId)).limit(1).all();
      const [phaseRow] = tx
        .select()
        .from(loopPhases)
        .where(and(eq(loopPhases.id, input.phaseId), eq(loopPhases.loopId, input.loopId)))
        .limit(1)
        .all();
      if (
        !loopRow ||
        !phaseRow ||
        loopRow.status !== 'paused' ||
        phaseRow.status !== 'pending' ||
        !isDeepStrictEqual(loopRow.state, input.expectedLoopState) ||
        !isDeepStrictEqual(phaseRow.state, input.expectedPhaseState)
      ) {
        conflict = true;
        return;
      }
      tx.update(loops)
        .set({
          state: {
            ...input.expectedLoopState,
            expectedFeatureHead: input.checkpointCommit,
            checkpointCommit: input.checkpointCommit,
          },
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(loops.id, input.loopId))
        .run();
      tx.update(loopPhases)
        .set({
          state: {
            ...input.expectedPhaseState,
            checkpointCommit: input.checkpointCommit,
          },
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(loopPhases.id, input.phaseId))
        .run();
    });
    if (conflict) {
      return err({ kind: 'conflict', message: 'Terminal correction retry changed concurrently' });
    }
    const loop = await getLoop(input.loopId);
    const phase = loop?.phases.find((candidate) => candidate.id === input.phaseId);
    if (!loop || !phase) return err({ kind: 'not-found', message: 'Terminal phase not found' });
    return ok({ loop, phase });
  } catch (error) {
    return err({
      kind: 'db-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
