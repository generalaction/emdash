import type { DispatchPassReport } from './dispatch';
import { isTerminalStatus, type OperationInitiator, type OperationRecord } from './record';

export interface OperationQueryFilter {
  resource?: { key: string; subtree?: boolean };
  name?: string | string[];
  active?: boolean;
  settledAfter?: number;
  parentId?: string | null;
  initiatorKind?: OperationInitiator['kind'];
  after?: { seq: number };
  limit?: number;
}

export interface OperationQueryPage {
  records: OperationRecord[];
  nextCursor?: { seq: number };
}

export type DisplayStatus =
  | { kind: 'queued' }
  | { kind: 'waiting'; blockedBy: string[]; barredOn: string[] }
  | { kind: 'deferred'; reason: 'not-before' | 'gated' }
  | { kind: 'running' }
  | { kind: 'waiting-children' }
  | { kind: OperationRecord['status'] };

export interface OperationTreeNode {
  record: OperationRecord;
  children: OperationTreeNode[];
  status: DisplayStatus;
}

export function queryRecords(
  records: readonly OperationRecord[],
  filter: OperationQueryFilter
): OperationQueryPage {
  const names = Array.isArray(filter.name) ? new Set(filter.name) : undefined;
  const filtered = records
    .filter((record) => {
      if (filter.resource) {
        const matches = record.claims.some((claim) =>
          filter.resource?.subtree
            ? claim.key === filter.resource.key || claim.key.startsWith(`${filter.resource.key}:`)
            : claim.key === filter.resource?.key
        );
        if (!matches) return false;
      }
      if (filter.name && !Array.isArray(filter.name) && record.name !== filter.name) return false;
      if (names && !names.has(record.name)) return false;
      if (filter.active !== undefined && isTerminalStatus(record.status) === filter.active) {
        return false;
      }
      if (
        filter.settledAfter !== undefined &&
        (!isTerminalStatus(record.status) || record.updatedAt < filter.settledAfter)
      ) {
        return false;
      }
      if (filter.parentId !== undefined) {
        if (filter.parentId === null && record.parentId !== undefined) return false;
        if (filter.parentId !== null && record.parentId !== filter.parentId) return false;
      }
      if (filter.initiatorKind && record.initiator.kind !== filter.initiatorKind) return false;
      if (filter.after && record.seq <= filter.after.seq) return false;
      return true;
    })
    .sort((a, b) => a.seq - b.seq);

  const limit = filter.limit ?? filtered.length;
  const page = filtered.slice(0, limit);
  const next = filtered[limit];
  return {
    records: page,
    nextCursor: next ? { seq: next.seq } : undefined,
  };
}

export function displayStatus(record: OperationRecord, report?: DispatchPassReport): DisplayStatus {
  if (record.status === 'pending') {
    const skipped = report?.skipped.find((entry) => entry.id === record.id);
    const deferred = report?.deferred.find((entry) => entry.id === record.id);
    if (skipped) {
      return { kind: 'waiting', blockedBy: skipped.blockedBy, barredOn: skipped.barredOn };
    }
    if (deferred) {
      return { kind: 'deferred', reason: deferred.reason };
    }
    return { kind: 'queued' };
  }
  if (record.status === 'running') {
    return { kind: 'running' };
  }
  if (record.status === 'waiting-children') {
    return { kind: 'waiting-children' };
  }
  return { kind: record.status };
}

export function activityFeed(
  records: readonly OperationRecord[],
  opts: { now: number; recentWindowMs: number }
): OperationRecord[] {
  const recentAfter = opts.now - opts.recentWindowMs;
  return records
    .filter((record) => !isTerminalStatus(record.status) || record.updatedAt >= recentAfter)
    .sort((a, b) => {
      const aActive = !isTerminalStatus(a.status);
      const bActive = !isTerminalStatus(b.status);
      if (aActive !== bActive) return aActive ? -1 : 1;
      const aFailed = a.status === 'failed' || a.status === 'rejected';
      const bFailed = b.status === 'failed' || b.status === 'rejected';
      if (aFailed !== bFailed) return aFailed ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
}

export function operationTreeView(records: readonly OperationRecord[]): OperationTreeNode[] {
  const byParent = new Map<string | undefined, OperationRecord[]>();
  for (const record of records) {
    const children = byParent.get(record.parentId) ?? [];
    children.push(record);
    byParent.set(record.parentId, children);
  }

  const build = (record: OperationRecord): OperationTreeNode => {
    const children = (byParent.get(record.id) ?? []).sort((a, b) => a.seq - b.seq).map(build);
    return { record, children, status: rollupStatus(record, children) };
  };

  return (byParent.get(undefined) ?? []).sort((a, b) => a.seq - b.seq).map(build);
}

export function provenanceChain(
  record: OperationRecord,
  byId: (id: string) => OperationRecord | undefined
): OperationInitiator[] {
  const chain: OperationInitiator[] = [record.initiator];
  let current = record.parentId ? byId(record.parentId) : undefined;
  while (current) {
    chain.push(current.initiator);
    current = current.parentId ? byId(current.parentId) : undefined;
  }
  return chain;
}

function rollupStatus(
  record: OperationRecord,
  children: readonly OperationTreeNode[]
): DisplayStatus {
  const own = displayStatus(record);
  if (
    children.some((child) => child.status.kind === 'failed' || child.status.kind === 'rejected')
  ) {
    return { kind: 'failed' };
  }
  if (children.some((child) => child.status.kind === 'running')) {
    return { kind: 'running' };
  }
  if (
    children.some(
      (child) =>
        child.status.kind === 'waiting' ||
        child.status.kind === 'queued' ||
        child.status.kind === 'deferred'
    )
  ) {
    return { kind: 'waiting-children' };
  }
  return own;
}
