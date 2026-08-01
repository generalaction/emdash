import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { loops } from '@main/db/schema';
import { err, ok, type Result } from '@main/lib/result';
import {
  loopSessionAttemptSchema,
  loopStateV2Schema,
  type LoopSessionAttempt,
  type LoopStateV2,
} from '@shared/core/loops/loop-state';
import type { LoopOperationError } from './types';

export async function commitSessionAttempt(input: {
  loopId: string;
  expected: LoopStateV2;
  previous?: LoopSessionAttempt;
  next: LoopSessionAttempt;
}): Promise<Result<LoopStateV2, LoopOperationError>> {
  const parsed = loopSessionAttemptSchema.safeParse(input.next);
  if (!parsed.success) {
    return err({ kind: 'invalid-input', message: 'Invalid Loop session attempt' });
  }

  try {
    let committed: LoopStateV2 | null = null;
    let conflict = false;
    db.transaction((tx) => {
      const [row] = tx
        .select({ state: loops.state })
        .from(loops)
        .where(eq(loops.id, input.loopId))
        .limit(1)
        .all();
      if (!row || JSON.stringify(row.state) !== JSON.stringify(input.expected)) {
        conflict = true;
        return;
      }
      const attempts = [...input.expected.sessionAttempts];
      if (input.previous) {
        const index = attempts.findIndex(
          (attempt) =>
            attempt.attemptId === input.previous?.attemptId &&
            attempt.conversationId === input.previous.conversationId
        );
        if (index < 0 || JSON.stringify(attempts[index]) !== JSON.stringify(input.previous)) {
          conflict = true;
          return;
        }
        attempts[index] = parsed.data;
      } else {
        if (
          attempts.some(
            (attempt) =>
              attempt.attemptId === parsed.data.attemptId ||
              attempt.conversationId === parsed.data.conversationId
          )
        ) {
          conflict = true;
          return;
        }
        attempts.push(parsed.data);
      }
      committed = loopStateV2Schema.parse({ ...input.expected, sessionAttempts: attempts });
      tx.update(loops)
        .set({ state: committed, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(loops.id, input.loopId))
        .run();
    });

    if (conflict || !committed) {
      return err({ kind: 'conflict', message: 'Loop session progress changed concurrently' });
    }
    return ok(committed);
  } catch (error) {
    return err({
      kind: 'db-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
