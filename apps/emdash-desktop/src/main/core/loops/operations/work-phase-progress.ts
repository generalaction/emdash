import { and, eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { loopPhases, loops } from '@main/db/schema';
import { err, ok, type Result } from '@main/lib/result';
import type { LoopPhaseHandoff, LoopPhaseState } from '@shared/core/loops/loop-phase-state';
import type { LoopStateV2 } from '@shared/core/loops/loop-state';
import type { LoopSessionAttempt } from '@shared/core/loops/loop-state';
import type { LoopPhase, LoopWithPhases } from '@shared/core/loops/loops';
import { getLoop } from './loop-operations';
import type { LoopOperationError } from './types';

export async function commitWorkPhaseProgress(input: {
  loopId: string;
  phaseId: string;
  expectedLoopState: LoopStateV2;
  expectedPhaseState: LoopPhaseState;
  checkpointCommit: string;
  handoff: LoopPhaseHandoff;
  summary: string;
  completedAt: string;
  previousAttempt: LoopSessionAttempt;
  completedAttempt: LoopSessionAttempt;
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
        JSON.stringify(loopRow.state) !== JSON.stringify(input.expectedLoopState) ||
        JSON.stringify(phaseRow.state) !== JSON.stringify(input.expectedPhaseState) ||
        !input.expectedLoopState.sessionAttempts.some(
          (attempt) => JSON.stringify(attempt) === JSON.stringify(input.previousAttempt)
        )
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
            sessionAttempts: input.expectedLoopState.sessionAttempts.map((attempt) =>
              attempt.attemptId === input.previousAttempt.attemptId &&
              attempt.conversationId === input.previousAttempt.conversationId
                ? input.completedAttempt
                : attempt
            ),
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
            result: {
              status: 'passed',
              summary: input.summary,
              completedAt: input.completedAt,
            },
          },
          lastError: null,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(loopPhases.id, input.phaseId))
        .run();
    });

    if (conflict) {
      return err({ kind: 'conflict', message: 'Loop work-phase progress changed concurrently' });
    }
    const loop = await getLoop(input.loopId);
    const phase = loop?.phases.find((candidate) => candidate.id === input.phaseId);
    if (!loop || !phase) return err({ kind: 'not-found', message: 'Loop phase not found' });
    return ok({ loop, phase });
  } catch (error) {
    return err({
      kind: 'db-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
