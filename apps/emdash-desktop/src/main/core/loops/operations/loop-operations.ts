import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { loopPhases, loops, tasks } from '@main/db/schema';
import { err, ok, type Result } from '@main/lib/result';
import type {
  CreateLoopParams,
  Loop,
  LoopConfig,
  LoopPhase,
  LoopPhaseCriteria,
  LoopWithPhases,
} from '@shared/core/loops/loops';
import {
  mapLoopPhaseRow,
  mapLoopRow,
  type LoopOperationError,
  type LoopPatch,
  type LoopPhasePatch,
} from './types';

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'loop';
}

async function uniqueSlug(taskId: string, base: string): Promise<string> {
  const rows = await db.select({ slug: loops.slug }).from(loops).where(eq(loops.taskId, taskId));
  const existing = new Set(rows.map((row) => row.slug));
  if (!existing.has(base)) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }

  return `${base}-${randomUUID().slice(0, 8)}`;
}

function normalizeCreateParams(
  params: CreateLoopParams
): Result<CreateLoopParams, LoopOperationError> {
  const name = params.name.trim();
  if (!name) {
    return err({ kind: 'invalid-input', message: 'Loop name is required' });
  }
  if (params.phases.length === 0) {
    return err({ kind: 'invalid-input', message: 'At least one phase is required' });
  }

  const phases = params.phases.map((phase, idx) => ({
    ...phase,
    name: phase.name.trim() || `Phase ${idx + 1}`,
    goal: phase.goal.trim(),
    criteria: phase.criteria.map((criterion) => ({
      description: criterion.description.trim(),
      verifier: criterion.verifier,
    })),
  }));

  if (phases.some((phase) => !phase.goal)) {
    return err({ kind: 'invalid-input', message: 'Every phase needs a goal' });
  }

  return ok({
    ...params,
    name,
    planSource: params.planSource.trim(),
    validationCommands: params.validationCommands.map((command) => command.trim()).filter(Boolean),
    verifiers: Array.from(new Set(params.verifiers)),
    phases,
  });
}

async function assertTaskBelongsToProject(
  projectId: string,
  taskId: string
): Promise<Result<void, LoopOperationError>> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);

  if (!row) {
    return err({ kind: 'not-found', message: 'Task not found for project' });
  }

  return ok();
}

function toLoopWithPhases(loop: Loop, phases: LoopPhase[]): LoopWithPhases {
  return {
    ...loop,
    phases: phases.filter((phase) => phase.loopId === loop.id).sort((a, b) => a.idx - b.idx),
  };
}

export async function createLoop(
  params: CreateLoopParams
): Promise<Result<LoopWithPhases, LoopOperationError>> {
  const normalized = normalizeCreateParams(params);
  if (!normalized.success) return normalized;

  const taskExists = await assertTaskBelongsToProject(params.projectId, params.taskId);
  if (!taskExists.success) return taskExists;

  const loopId = normalized.data.id ?? randomUUID();
  const slug = await uniqueSlug(normalized.data.taskId, slugify(normalized.data.name));
  const config: LoopConfig = {
    version: '1',
    verifiers: normalized.data.verifiers,
    reviewEnabled: normalized.data.reviewEnabled,
    validationCommands: normalized.data.validationCommands,
    planSource: normalized.data.planSource,
    ...(normalized.data.agentBrowser ? { agentBrowser: normalized.data.agentBrowser } : {}),
  };

  try {
    const result = db.transaction((tx) => {
      const [loopRow] = tx
        .insert(loops)
        .values({
          id: loopId,
          projectId: normalized.data.projectId,
          taskId: normalized.data.taskId,
          name: normalized.data.name,
          slug,
          status: 'draft',
          currentPhaseIndex: 0,
          config,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .returning()
        .all();

      const phaseRows = normalized.data.phases.map((phase, idx) => {
        const criteria: LoopPhaseCriteria = {
          version: '1',
          criteria: phase.criteria.map((criterion) => ({
            ...criterion,
            status: 'pending',
          })),
        };

        const [phaseRow] = tx
          .insert(loopPhases)
          .values({
            id: randomUUID(),
            loopId,
            idx,
            name: phase.name,
            goal: phase.goal,
            status: 'pending',
            attempts: 0,
            criteria,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          })
          .returning()
          .all();
        return phaseRow;
      });

      return toLoopWithPhases(mapLoopRow(loopRow), phaseRows.map(mapLoopPhaseRow));
    });

    return ok(result);
  } catch (error) {
    return err({
      kind: 'db-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getLoop(loopId: string): Promise<LoopWithPhases | null> {
  const [loopRow] = await db.select().from(loops).where(eq(loops.id, loopId)).limit(1);
  if (!loopRow) return null;

  const phaseRows = await db
    .select()
    .from(loopPhases)
    .where(eq(loopPhases.loopId, loopId))
    .orderBy(asc(loopPhases.idx));

  return toLoopWithPhases(mapLoopRow(loopRow), phaseRows.map(mapLoopPhaseRow));
}

export async function getLoopsForProject(projectId: string): Promise<LoopWithPhases[]> {
  const loopRows = await db
    .select()
    .from(loops)
    .where(eq(loops.projectId, projectId))
    .orderBy(desc(loops.updatedAt));

  if (loopRows.length === 0) return [];

  const loopIds = loopRows.map((loop) => loop.id);
  const phaseRows = await db
    .select()
    .from(loopPhases)
    .where(inArray(loopPhases.loopId, loopIds))
    .orderBy(asc(loopPhases.idx));
  const phases = phaseRows.map(mapLoopPhaseRow);

  return loopRows.map((row) => toLoopWithPhases(mapLoopRow(row), phases));
}

export async function updateLoop(
  loopId: string,
  patch: LoopPatch
): Promise<Result<Loop, LoopOperationError>> {
  const [row] = await db
    .update(loops)
    .set({
      ...patch,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(loops.id, loopId))
    .returning();

  if (!row) return err({ kind: 'not-found', message: 'Loop not found' });
  return ok(mapLoopRow(row));
}

export async function updatePhase(
  phaseId: string,
  patch: LoopPhasePatch
): Promise<Result<LoopPhase, LoopOperationError>> {
  const [row] = await db
    .update(loopPhases)
    .set({
      ...patch,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(loopPhases.id, phaseId))
    .returning();

  if (!row) return err({ kind: 'not-found', message: 'Loop phase not found' });
  return ok(mapLoopPhaseRow(row));
}

export async function resetPhaseForRetry(
  phaseId: string
): Promise<Result<LoopPhase, LoopOperationError>> {
  const [row] = await db.select().from(loopPhases).where(eq(loopPhases.id, phaseId)).limit(1);
  if (!row) return err({ kind: 'not-found', message: 'Loop phase not found' });

  const criteria = row.criteria
    ? {
        ...row.criteria,
        criteria: row.criteria.criteria.map((criterion) => ({
          description: criterion.description,
          verifier: criterion.verifier,
          status: 'pending' as const,
        })),
      }
    : null;

  return updatePhase(phaseId, {
    status: 'pending',
    attempts: 0,
    conversationId: null,
    criteria,
    lastError: null,
  });
}

export async function deleteLoop(loopId: string): Promise<Result<void, LoopOperationError>> {
  const rows = await db.delete(loops).where(eq(loops.id, loopId)).returning({ id: loops.id });
  if (rows.length === 0) return err({ kind: 'not-found', message: 'Loop not found' });
  return ok();
}

export async function pauseRunningLoopsForBoot(): Promise<Loop[]> {
  const rows = await db
    .update(loops)
    .set({ status: 'paused', updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(loops.status, 'running'))
    .returning();
  return rows.map(mapLoopRow);
}
