import { and, eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { loopPhases, loops } from '@main/db/schema';
import { err, ok } from '@main/lib/result';
import { loopPhaseStateV2Schema } from '@shared/core/loops/loop-phase-state';
import { loopStateV2Schema } from '@shared/core/loops/loop-state';
import {
  reduceE2EProgress,
  sameE2EDurableProgress,
  type E2EProgressPort,
} from '../gates/clean-room-e2e-progress';

function parseProgress(loopState: unknown, phaseState: unknown) {
  const parsedLoop = loopStateV2Schema.safeParse(loopState);
  const parsedPhase = loopPhaseStateV2Schema.safeParse(phaseState);
  if (!parsedLoop.success || !parsedPhase.success) {
    return err({
      type: 'invalid-progress',
      message: 'Durable E2E progress is missing or invalid.',
    });
  }
  return ok({ loopState: parsedLoop.data, phaseState: parsedPhase.data });
}

/** Production LoopState/phase-state CAS authority for the clean-room E2E gate. */
export const e2eProgressStore: E2EProgressPort = {
  async read({ loopId, phaseId }) {
    try {
      let snapshot: ReturnType<typeof parseProgress> | undefined;
      db.transaction((tx) => {
        const [loopRow] = tx
          .select({ state: loops.state })
          .from(loops)
          .where(eq(loops.id, loopId))
          .all();
        const [phaseRow] = tx
          .select({ state: loopPhases.state })
          .from(loopPhases)
          .where(and(eq(loopPhases.id, phaseId), eq(loopPhases.loopId, loopId)))
          .all();
        snapshot = loopRow && phaseRow ? parseProgress(loopRow.state, phaseRow.state) : undefined;
      });
      return snapshot ?? err({ type: 'not-found', message: 'Loop E2E phase was not found.' });
    } catch (error) {
      return err({
        type: 'db-error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async commit({ loopId, phaseId, expected, transition }) {
    try {
      let result:
        | ReturnType<typeof parseProgress>
        | ReturnType<typeof reduceE2EProgress>
        | undefined;
      db.transaction((tx) => {
        const [loopRow] = tx
          .select({ state: loops.state })
          .from(loops)
          .where(eq(loops.id, loopId))
          .all();
        const [phaseRow] = tx
          .select({ state: loopPhases.state })
          .from(loopPhases)
          .where(and(eq(loopPhases.id, phaseId), eq(loopPhases.loopId, loopId)))
          .all();
        if (!loopRow || !phaseRow) {
          result = err({ type: 'not-found', message: 'Loop E2E phase was not found.' });
          return;
        }
        const current = parseProgress(loopRow.state, phaseRow.state);
        if (!current.success) {
          result = current;
          return;
        }
        if (!sameE2EDurableProgress(current.data, expected)) {
          result = err({ type: 'conflict', message: 'Loop E2E progress changed concurrently.' });
          return;
        }
        const reduced = reduceE2EProgress(current.data, transition);
        if (!reduced.success) {
          result = reduced;
          return;
        }
        tx.update(loops)
          .set({ state: reduced.data.loopState, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(loops.id, loopId))
          .run();
        tx.update(loopPhases)
          .set({
            state: reduced.data.phaseState,
            ...(transition.kind === 'terminal'
              ? {
                  status:
                    transition.result.status === 'passed'
                      ? ('passed' as const)
                      : ('failed' as const),
                  lastError:
                    transition.result.status === 'passed' ? null : transition.result.summary,
                }
              : {}),
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .where(and(eq(loopPhases.id, phaseId), eq(loopPhases.loopId, loopId)))
          .run();
        result = ok(reduced.data);
      });
      return (
        result ?? err({ type: 'db-error', message: 'E2E progress transaction did not settle.' })
      );
    } catch (error) {
      return err({
        type: 'db-error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
