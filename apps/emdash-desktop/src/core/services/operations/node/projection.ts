import {
  nonTerminalOperationStatuses,
  rollupStatus,
  type OperationDisplayState,
  type OperationEntityKind,
  type OperationTree,
  type OperationTreeKey,
  type OperationTreeList,
} from '@emdash/core/primitives/operations/api';
import { log } from '@emdash/shared/logger';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDb } from '@core/services/app-db/node/db';
import { lifecycleOperations, type LifecycleOperationRow } from '@core/services/app-db/node/schema';
import type { OperationDefinition, OperationDescription, OperationProgress } from './definition';

type TerminalChildCounts = {
  total: number;
  done: number;
};

export function operationTreeKey(key: OperationTreeKey): string {
  return key.projectId ?? '*';
}

export async function loadOperationTrees(options: {
  db: AppDb;
  definitions: Map<LifecycleOperationRow['kind'], OperationDefinition>;
  progress: ReadonlyMap<string, OperationProgress>;
  hostIsOnline(hostRef: string): boolean;
  projectId?: string;
}): Promise<OperationTreeList> {
  const rows = await options.db
    .select()
    .from(lifecycleOperations)
    .where(
      and(
        inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses]),
        options.projectId === undefined
          ? undefined
          : eq(lifecycleOperations.projectId, options.projectId)
      )
    );
  const terminalChildren = await options.db
    .select()
    .from(lifecycleOperations)
    .where(
      and(
        inArray(lifecycleOperations.status, ['succeeded' as const, 'abandoned' as const]),
        options.projectId === undefined
          ? undefined
          : eq(lifecycleOperations.projectId, options.projectId)
      )
    );
  const activeChildrenByParent = groupByParent(rows);
  const terminalChildrenByParent = groupTerminalChildrenByParent(terminalChildren);
  const activeOperationIds = new Set(rows.map((row) => row.id));
  const list: OperationTreeList = {};
  for (const row of rows) {
    if (row.parentOperationId !== null && activeOperationIds.has(row.parentOperationId)) continue;
    const tree = await toOperationTree({
      ...options,
      root: row,
      activeChildren: activeChildrenByParent.get(row.id) ?? [],
      terminalChildren: terminalChildrenByParent.get(row.id) ?? { total: 0, done: 0 },
    });
    if (tree) list[row.id] = tree;
  }
  return list;
}

async function toOperationTree(options: {
  db: AppDb;
  definitions: Map<LifecycleOperationRow['kind'], OperationDefinition>;
  progress: ReadonlyMap<string, OperationProgress>;
  hostIsOnline(hostRef: string): boolean;
  root: LifecycleOperationRow;
  activeChildren: LifecycleOperationRow[];
  terminalChildren: TerminalChildCounts;
}): Promise<OperationTree | undefined> {
  const rootState = await toOperationDisplayState({
    ...options,
    row: options.root,
  });
  if (!rootState) return undefined;
  const children = (
    await Promise.all(
      options.activeChildren.map((child) =>
        toOperationDisplayState({
          ...options,
          row: child,
        })
      )
    )
  ).filter((child): child is OperationDisplayState => child !== undefined);
  const nodes = [rootState, ...children];
  return {
    root: rootState,
    children,
    rollup: {
      total: children.length + options.terminalChildren.total,
      done: options.terminalChildren.done,
      status: rollupStatus(nodes),
    },
  };
}

async function toOperationDisplayState(options: {
  db: AppDb;
  definitions: Map<LifecycleOperationRow['kind'], OperationDefinition>;
  progress: ReadonlyMap<string, OperationProgress>;
  hostIsOnline(hostRef: string): boolean;
  row: LifecycleOperationRow;
}): Promise<OperationDisplayState | undefined> {
  const definition = options.definitions.get(options.row.kind);
  if (!definition) return undefined;
  let description: OperationDescription = {};
  try {
    description = await definition.describe({ operation: options.row, db: options.db });
  } catch (error) {
    log.warn('lifecycle operation description failed', {
      operationId: options.row.id,
      kind: options.row.kind,
      error: String(error),
    });
  }
  return operationDisplayStateFromRow(
    options.row,
    definition.entityKind,
    options.hostIsOnline(options.row.hostRef),
    description,
    options.progress.get(options.row.id)
  );
}

function operationDisplayStateFromRow(
  operation: LifecycleOperationRow,
  entityKind: OperationEntityKind,
  hostOnline: boolean,
  description: OperationDescription,
  progress?: OperationProgress
): OperationDisplayState | undefined {
  if (!operation.entityKey) return undefined;
  const base = {
    operationId: operation.id,
    operationKind: operation.kind,
    entityId: operation.entityKey,
    entityKind,
    projectId: operation.projectId ?? undefined,
    entityName: operation.payload.entityName ?? description.entityName,
    hostRef: operation.hostRef,
    hostLabel: operation.payload.hostLabel,
    workspacePath: description.workspacePath ?? operation.payload.workspacePath,
    branchName: description.branchName ?? operation.payload.branchName,
    createdAt: operation.createdAt,
    attempt: operation.attempt,
    currentStep: progress?.currentStep,
    completedSteps: progress?.completedSteps,
    totalSteps: progress?.totalSteps,
  };
  switch (operation.status) {
    case 'waiting-children':
      return { ...base, status: 'waiting-children' };
    case 'pending':
      return { ...base, status: hostOnline ? 'cleaning' : 'blocked-host-offline' };
    case 'running':
      if (progress?.waiting) return { ...base, status: 'waiting' };
      return { ...base, status: 'cleaning' };
    case 'awaiting-confirmation':
      return {
        ...base,
        status: 'awaiting-confirmation',
        confirmationReason: operation.confirmationReason ?? 'stale',
        error: operation.error ?? undefined,
      };
    case 'failed':
      return { ...base, status: 'failed', error: operation.error ?? 'Cleanup failed' };
    case 'succeeded':
    case 'abandoned':
      return undefined;
  }
}

function groupByParent(rows: LifecycleOperationRow[]): Map<string, LifecycleOperationRow[]> {
  const grouped = new Map<string, LifecycleOperationRow[]>();
  for (const row of rows) {
    if (row.parentOperationId === null) continue;
    const existing = grouped.get(row.parentOperationId);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.parentOperationId, [row]);
    }
  }
  return grouped;
}

function groupTerminalChildrenByParent(
  rows: LifecycleOperationRow[]
): Map<string, TerminalChildCounts> {
  const grouped = new Map<string, TerminalChildCounts>();
  for (const row of rows) {
    if (row.parentOperationId === null) continue;
    const existing = grouped.get(row.parentOperationId) ?? { total: 0, done: 0 };
    existing.total += 1;
    if (row.status === 'succeeded' || row.status === 'abandoned') existing.done += 1;
    grouped.set(row.parentOperationId, existing);
  }
  return grouped;
}
