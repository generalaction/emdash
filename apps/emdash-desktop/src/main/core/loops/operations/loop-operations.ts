import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type DrizzleTx } from '@main/db/client';
import { loopPhases, loops, tasks } from '@main/db/schema';
import { err, ok, type Result } from '@main/lib/result';
import type { LoopPhaseState } from '@shared/core/loops/loop-phase-state';
import type { LoopStateV2 } from '@shared/core/loops/loop-state';
import {
  DEFAULT_LOOP_PROVIDER,
  createLoopConfigV2,
  type CreateLoopParams,
  type Loop,
  type LoopConfig,
  type LoopPhase,
  type LoopPhaseCriteria,
  type LoopPhaseKind,
  orderedLoopPhaseKinds,
  type LoopWithPhases,
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

export type NewLoopWorkPhaseInput = {
  name: string;
  goal: string;
};

export type NewLoopAuthoringInput = {
  id?: string;
  projectId: string;
  taskId: string;
  name: string;
  model: string;
  planSource: string;
  validationCommands: readonly string[];
  terminalGates: { review: boolean; e2e: boolean };
  browserPreview: { enabled: boolean };
  workPhases: readonly NewLoopWorkPhaseInput[];
  acceptanceCriteria: readonly string[];
};

type PreparedNewLoopPhase = {
  id: string;
  loopId: string;
  idx: number;
  name: string;
  goal: string;
  kind: LoopPhaseKind;
  criteria: LoopPhaseCriteria;
  state: LoopPhaseState;
};

export type PreparedNewLoop = {
  loopId: string;
  projectId: string;
  taskId: string;
  name: string;
  slug: string;
  config: ReturnType<typeof createLoopConfigV2>;
  state: LoopStateV2;
  phases: PreparedNewLoopPhase[];
};

function initialPhaseState(): LoopPhaseState {
  return {
    version: '2',
    checkpointCommit: null,
    handoff: null,
    retryHandoffs: [],
    result: null,
  };
}

export function prepareNewLoop(
  params: NewLoopAuthoringInput
): Result<PreparedNewLoop, LoopOperationError> {
  const name = params.name.trim();
  const model = params.model.trim();
  const validationCommands = params.validationCommands
    .map((command) => command.trim())
    .filter(Boolean);
  const workPhases = params.workPhases.map((phase, index) => ({
    name: phase.name.trim() || `Phase ${index + 1}`,
    goal: phase.goal.trim(),
  }));
  const acceptanceCriteria = params.acceptanceCriteria
    .map((criterion) => criterion.trim())
    .filter(Boolean);

  if (!name) return err({ kind: 'invalid-input', message: 'Loop name is required' });
  if (!model) return err({ kind: 'invalid-input', message: 'Loop model is required' });
  if (validationCommands.length === 0) {
    return err({ kind: 'invalid-input', message: 'At least one validation command is required' });
  }
  if (workPhases.length === 0 || workPhases.some((phase) => !phase.goal)) {
    return err({ kind: 'invalid-input', message: 'At least one complete work phase is required' });
  }
  if (params.browserPreview.enabled !== params.terminalGates.e2e) {
    return err({
      kind: 'invalid-input',
      message: 'Browser preview and the E2E terminal gate must be enabled together',
    });
  }
  if (params.terminalGates.e2e && acceptanceCriteria.length === 0) {
    return err({ kind: 'invalid-input', message: 'E2E acceptance criteria are required' });
  }

  const loopId = params.id ?? randomUUID();
  const kinds = orderedLoopPhaseKinds(workPhases.length, params.terminalGates);
  const phases = kinds.map((kind, idx): PreparedNewLoopPhase => {
    const workPhase = kind === 'work' ? workPhases[idx] : undefined;
    const criteria: LoopPhaseCriteria = {
      version: '1',
      criteria:
        kind === 'e2e'
          ? acceptanceCriteria.map((description) => ({
              description,
              verifier: 'agent-browser' as const,
              status: 'pending' as const,
            }))
          : [],
    };
    return {
      id: randomUUID(),
      loopId,
      idx,
      kind,
      name: workPhase?.name ?? (kind === 'review' ? 'Review' : 'E2E'),
      goal:
        workPhase?.goal ??
        (kind === 'review'
          ? 'Review the complete implementation and resolve all blocking findings.'
          : 'Recreate and verify the feature in a clean-room workspace.'),
      criteria,
      state: initialPhaseState(),
    };
  });

  return ok({
    loopId,
    projectId: params.projectId,
    taskId: params.taskId,
    name,
    slug: slugify(name),
    config: createLoopConfigV2({
      model,
      validationCommands,
      planSource: params.planSource.trim(),
      terminalGates: params.terminalGates,
      browserPreview: params.browserPreview,
    }),
    state: {
      version: '2',
      baseCommit: null,
      expectedFeatureHead: null,
      checkpointCommit: null,
      e2eAttemptsConsumed: 0,
      sessionAttempts: [],
      verification: null,
    },
    phases,
  });
}

export function commitPreparedLoop(prepared: PreparedNewLoop, tx: DrizzleTx): LoopWithPhases {
  const [loopRow] = tx
    .insert(loops)
    .values({
      id: prepared.loopId,
      projectId: prepared.projectId,
      taskId: prepared.taskId,
      name: prepared.name,
      slug: prepared.slug,
      status: 'draft',
      currentPhaseIndex: 0,
      config: prepared.config,
      isPrimary: true,
      state: prepared.state,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning()
    .all();

  const phaseRows = prepared.phases.map((phase) => {
    const [row] = tx
      .insert(loopPhases)
      .values({
        ...phase,
        status: 'pending',
        attempts: 0,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .returning()
      .all();
    return row;
  });

  return toLoopWithPhases(mapLoopRow(loopRow), phaseRows.map(mapLoopPhaseRow));
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
    provider: normalized.data.provider ?? DEFAULT_LOOP_PROVIDER,
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
  const state = row.state
    ? {
        ...row.state,
        handoff: null,
        result: null,
      }
    : null;

  return updatePhase(phaseId, {
    status: 'pending',
    attempts: 0,
    conversationId: null,
    criteria,
    state,
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
