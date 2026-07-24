import type { StoreHandle } from '@primitives/sqlite-store/api';
import { and, desc, eq, gt, inArray, isNotNull, lt, lte, ne, sql } from 'drizzle-orm';
import type { AutomationId } from '../../api/deployment';
import {
  automationRunSchema,
  automationRunStatusSchema,
  type AutomationRun,
  type AutomationRunId,
  type AutomationRunStatus,
} from '../../api/run';
import { parseRunPayload, serializeRunPayload } from './payload-codecs';
import { automationJournal, automationRuns } from './schema';
import type { AutomationsDb } from './store';

const IMMUTABLE_RUN_KEYS = ['id', 'automationId', 'seq'] as const;

export class AutomationRunStore {
  constructor(private readonly handle: StoreHandle<AutomationsDb>) {}

  private claimSeq(): number {
    const claimed = this.handle.db
      .update(automationJournal)
      .set({ nextSeq: sql`${automationJournal.nextSeq} + 1` })
      .where(eq(automationJournal.singleton, 1))
      .returning({ seq: sql<number>`${automationJournal.nextSeq} - 1` })
      .get();
    if (!claimed) throw new Error('Automation journal singleton is missing');
    return claimed.seq;
  }

  insertRun(run: Omit<AutomationRun, 'seq'>): AutomationRun | null {
    return this.handle.transaction(() => {
      const seq = this.claimSeq();
      const stored = automationRunSchema.parse({ ...run, seq });
      const payload = serializeRunPayload(stored);

      try {
        this.handle.db
          .insert(automationRuns)
          .values({
            id: stored.id,
            seq: stored.seq,
            automationId: stored.automationId,
            status: stored.status,
            scheduledAt: stored.scheduledAt,
            deadlineAt: stored.deadlineAt,
            payload,
          })
          .run();
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
          return null;
        }
        throw error;
      }
      return stored;
    });
  }

  getRun(id: AutomationRunId): AutomationRun | null {
    const row = this.handle.db
      .select({ payload: automationRuns.payload })
      .from(automationRuns)
      .where(eq(automationRuns.id, id))
      .get();
    return row ? parseRunPayload(row.payload) : null;
  }

  getRunForAutomation(automationId: AutomationId, id: AutomationRunId): AutomationRun | null {
    const row = this.handle.db
      .select({ payload: automationRuns.payload })
      .from(automationRuns)
      .where(and(eq(automationRuns.automationId, automationId), eq(automationRuns.id, id)))
      .get();
    return row ? parseRunPayload(row.payload) : null;
  }

  transitionRun(
    id: AutomationRunId,
    from: AutomationRunStatus | AutomationRunStatus[],
    patch: Partial<AutomationRun>
  ): AutomationRun | null {
    for (const key of IMMUTABLE_RUN_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        throw new TypeError(`Run transition patch cannot change ${key}`);
      }
    }

    const fromStatuses = Array.isArray(from) ? from : [from];
    const parsedStatuses = automationRunStatusSchema.array().min(1).parse(fromStatuses);

    return this.handle.transaction(() => {
      const statusCondition =
        parsedStatuses.length === 1
          ? eq(automationRuns.status, parsedStatuses[0])
          : inArray(automationRuns.status, parsedStatuses);

      const row = this.handle.db
        .select({ payload: automationRuns.payload })
        .from(automationRuns)
        .where(and(eq(automationRuns.id, id), statusCondition))
        .get();
      if (!row) return null;

      const seq = this.claimSeq();
      const transitioned = automationRunSchema.parse({
        ...parseRunPayload(row.payload),
        ...patch,
        seq,
      });

      const result = this.handle.db
        .update(automationRuns)
        .set({
          seq: transitioned.seq,
          status: transitioned.status,
          scheduledAt: transitioned.scheduledAt,
          deadlineAt: transitioned.deadlineAt,
          payload: serializeRunPayload(transitioned),
        })
        .where(and(eq(automationRuns.id, id), statusCondition))
        .run();

      if (changesAsNumber(result.changes) !== 1) {
        throw new Error(`Automation run ${id} changed during a serialized transition`);
      }
      return transitioned;
    });
  }

  getScheduledRun(automationId: AutomationId): AutomationRun | null {
    const row = this.handle.db
      .select({ payload: automationRuns.payload })
      .from(automationRuns)
      .where(
        and(eq(automationRuns.automationId, automationId), eq(automationRuns.status, 'scheduled'))
      )
      .get();
    return row ? parseRunPayload(row.payload) : null;
  }

  listDueScheduledRuns(now: number, limit: number): AutomationRun[] {
    if (!Number.isSafeInteger(now)) {
      throw new RangeError(`Scheduler timestamp must be a safe integer: ${now}`);
    }
    validateLimit(limit, 'Scheduled run limit');
    return this.handle.db
      .select({ payload: automationRuns.payload })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.status, 'scheduled'),
          isNotNull(automationRuns.scheduledAt),
          lte(automationRuns.scheduledAt, now)
        )
      )
      .orderBy(automationRuns.scheduledAt, automationRuns.seq)
      .limit(limit)
      .all()
      .map(({ payload }) => parseRunPayload(payload));
  }

  listQueuedRuns(limit: number): AutomationRun[] {
    validateLimit(limit, 'Queued run limit');
    return this.handle.db
      .select({ payload: automationRuns.payload })
      .from(automationRuns)
      .where(eq(automationRuns.status, 'queued'))
      .orderBy(automationRuns.seq)
      .limit(limit)
      .all()
      .map(({ payload }) => parseRunPayload(payload));
  }

  listRunsInStatuses(statuses: AutomationRunStatus[]): AutomationRun[] {
    if (statuses.length === 0) return [];
    const parsedStatuses = automationRunStatusSchema.array().parse(statuses);
    return this.handle.db
      .select({ payload: automationRuns.payload })
      .from(automationRuns)
      .where(inArray(automationRuns.status, parsedStatuses))
      .orderBy(automationRuns.seq)
      .all()
      .map(({ payload }) => parseRunPayload(payload));
  }

  listChangedRuns(input: {
    sinceSeq: number;
    automationId: AutomationId;
    limit: number;
  }): AutomationRun[] {
    if (!Number.isSafeInteger(input.sinceSeq) || input.sinceSeq < 0) {
      throw new RangeError(
        `Run journal cursor must be a non-negative safe integer: ${input.sinceSeq}`
      );
    }
    validateLimit(input.limit, 'Run journal limit');
    return this.handle.db
      .select({ payload: automationRuns.payload })
      .from(automationRuns)
      .where(
        and(
          gt(automationRuns.seq, input.sinceSeq),
          eq(automationRuns.automationId, input.automationId)
        )
      )
      .orderBy(automationRuns.seq)
      .limit(input.limit)
      .all()
      .map(({ payload }) => parseRunPayload(payload));
  }

  listRuns(input: {
    automationId: AutomationId;
    status?: AutomationRunStatus;
    before?: number;
    limit: number;
  }): AutomationRun[] {
    validateLimit(input.limit, 'Run history limit');
    if (input.before !== undefined && (!Number.isSafeInteger(input.before) || input.before <= 0)) {
      throw new RangeError(`Run history cursor must be a positive safe integer: ${input.before}`);
    }

    const conditions = [eq(automationRuns.automationId, input.automationId)];
    if (input.status !== undefined) {
      conditions.push(eq(automationRuns.status, automationRunStatusSchema.parse(input.status)));
    } else {
      conditions.push(ne(automationRuns.status, 'scheduled'));
    }
    if (input.before !== undefined) conditions.push(lt(automationRuns.seq, input.before));

    return this.handle.db
      .select({ payload: automationRuns.payload })
      .from(automationRuns)
      .where(and(...conditions))
      .orderBy(desc(automationRuns.seq))
      .limit(input.limit)
      .all()
      .map(({ payload }) => parseRunPayload(payload));
  }

  countRunsByStatus(automationId: AutomationId): Partial<Record<AutomationRunStatus, number>> {
    const rows = this.handle.db
      .select({ status: automationRuns.status, count: sql<number>`count(*)` })
      .from(automationRuns)
      .where(eq(automationRuns.automationId, automationId))
      .groupBy(automationRuns.status)
      .all();
    return Object.fromEntries(rows.map(({ status, count }) => [status, Number(count)]));
  }

  getLatestRun(automationId: AutomationId): AutomationRun | null {
    const row = this.handle.db
      .select({ payload: automationRuns.payload })
      .from(automationRuns)
      .where(
        and(eq(automationRuns.automationId, automationId), ne(automationRuns.status, 'scheduled'))
      )
      .orderBy(desc(automationRuns.seq))
      .limit(1)
      .get();
    return row ? parseRunPayload(row.payload) : null;
  }

  getNextScheduledRun(automationId: AutomationId): AutomationRun | null {
    const row = this.handle.db
      .select({ payload: automationRuns.payload })
      .from(automationRuns)
      .where(
        and(eq(automationRuns.automationId, automationId), eq(automationRuns.status, 'scheduled'))
      )
      .orderBy(automationRuns.scheduledAt, automationRuns.seq)
      .limit(1)
      .get();
    return row ? parseRunPayload(row.payload) : null;
  }

  deleteRunsForAutomation(automationId: AutomationId): number {
    return this.handle.transaction(() => {
      const result = this.handle.db
        .delete(automationRuns)
        .where(eq(automationRuns.automationId, automationId))
        .run();
      return changesAsNumber(result.changes);
    });
  }
}

function validateLimit(limit: number, label: string): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError(`${label} must be a positive safe integer: ${limit}`);
  }
}

function changesAsNumber(changes: number | bigint): number {
  return typeof changes === 'bigint' ? Number(changes) : changes;
}
