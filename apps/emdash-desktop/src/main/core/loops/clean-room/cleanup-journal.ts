import { err, ok, type Result } from '@emdash/shared';
import type { MachineRef } from '@main/core/runtime/types';
import type { LoopSessionTarget } from '@shared/core/loops/loop-state';

export type CleanRoomPendingCleanup = {
  version: '1';
  cleanupId: string;
  verificationRunId: string;
  attempt: number;
  projectId: string;
  workspaceId: string;
  target: { path: string; machine: MachineRef };
  featureTarget: LoopSessionTarget;
  branchName: string;
  baseCommit: string;
  expectedFeatureHead: string;
  teardownRequired: boolean;
  branchHead?: string | null;
  completed: { teardown: boolean; worktree: boolean; branch: boolean };
  revision: number;
};

export type CleanRoomCleanupJournal = {
  load(cleanupId: string): Promise<CleanRoomPendingCleanup | undefined>;
  list(): Promise<CleanRoomPendingCleanup[]>;
  save(record: CleanRoomPendingCleanup, expectedRevision: number | null): Promise<boolean>;
  remove(cleanupId: string, expectedRevision: number): Promise<boolean>;
};

export type CleanRoomCleanupRecordError = {
  type: 'invalid-cleanup-record';
  message: string;
};

const FULL_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const MAX_SERIALIZED_RECORD_BYTES = 16_384;
const TOP_LEVEL_KEYS = new Set([
  'version',
  'cleanupId',
  'verificationRunId',
  'attempt',
  'projectId',
  'workspaceId',
  'target',
  'featureTarget',
  'branchName',
  'baseCommit',
  'expectedFeatureHead',
  'teardownRequired',
  'branchHead',
  'completed',
  'revision',
]);

export function createInMemoryCleanRoomCleanupJournal(
  records = new Map<string, CleanRoomPendingCleanup>()
): CleanRoomCleanupJournal {
  return {
    async load(cleanupId) {
      const record = records.get(cleanupId);
      return record ? clonePendingCleanup(record) : undefined;
    },
    async list() {
      return [...records.values()].map(clonePendingCleanup);
    },
    async save(record, expectedRevision) {
      const current = records.get(record.cleanupId);
      if (expectedRevision === null) {
        if (current || record.revision !== 0) return false;
      } else if (
        !current ||
        current.revision !== expectedRevision ||
        record.revision !== expectedRevision + 1
      ) {
        return false;
      }
      records.set(record.cleanupId, clonePendingCleanup(record));
      return true;
    },
    async remove(cleanupId, expectedRevision) {
      const current = records.get(cleanupId);
      if (!current || current.revision !== expectedRevision) return false;
      records.delete(cleanupId);
      return true;
    },
  };
}

export function parseCleanRoomPendingCleanup(
  candidate: unknown
): Result<CleanRoomPendingCleanup, CleanRoomCleanupRecordError> {
  let stable: unknown;
  try {
    if (!isPlainObject(candidate) || !hasOnlyKeys(candidate, TOP_LEVEL_KEYS)) {
      return invalidRecord();
    }
    const serialized = JSON.stringify(candidate);
    if (
      !serialized ||
      new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_RECORD_BYTES
    ) {
      return invalidRecord();
    }
    stable = JSON.parse(serialized);
  } catch {
    return invalidRecord();
  }
  if (!isPlainObject(stable) || !hasOnlyKeys(stable, TOP_LEVEL_KEYS)) {
    return invalidRecord();
  }
  const record = stable;

  const target = record.target;
  const featureTarget = record.featureTarget;
  const completed = record.completed;
  if (
    !isPlainObject(target) ||
    !hasExactKeys(target, ['path', 'machine']) ||
    !isPlainObject(featureTarget) ||
    !hasExactKeys(featureTarget, ['workspaceId', 'path', 'machine']) ||
    !isPlainObject(completed) ||
    !hasExactKeys(completed, ['teardown', 'worktree', 'branch'])
  ) {
    return invalidRecord();
  }
  const targetMachine = parseMachine(target.machine);
  const featureMachine = parseMachine(featureTarget.machine);
  if (!targetMachine || !featureMachine || !sameMachine(targetMachine, featureMachine)) {
    return invalidRecord();
  }
  if (
    typeof record.teardownRequired !== 'boolean' ||
    typeof completed.teardown !== 'boolean' ||
    typeof completed.worktree !== 'boolean' ||
    typeof completed.branch !== 'boolean'
  ) {
    return invalidRecord();
  }
  const teardownRequired = record.teardownRequired;
  const teardownCompleted = completed.teardown;
  const worktreeCompleted = completed.worktree;
  const branchCompleted = completed.branch;

  const branchHeadPresent = Object.hasOwn(record, 'branchHead');
  const branchHead = record.branchHead;
  const valid =
    record.version === '1' &&
    boundedString(record.cleanupId, 180) &&
    boundedString(record.verificationRunId, 256) &&
    Number.isSafeInteger(record.attempt) &&
    Number(record.attempt) >= 1 &&
    Number(record.attempt) <= 1_000_000 &&
    boundedString(record.projectId, 256) &&
    boundedString(record.workspaceId, 160) &&
    /^loop-verify-[a-zA-Z0-9_-]+$/.test(String(record.workspaceId)) &&
    boundedString(target.path, 4_096) &&
    boundedString(featureTarget.workspaceId, 256) &&
    boundedString(featureTarget.path, 4_096) &&
    boundedString(record.branchName, 180) &&
    record.cleanupId === `cleanup-${String(record.workspaceId)}` &&
    record.branchName === `emdash/${String(record.workspaceId)}` &&
    typeof record.baseCommit === 'string' &&
    FULL_COMMIT.test(record.baseCommit) &&
    typeof record.expectedFeatureHead === 'string' &&
    FULL_COMMIT.test(record.expectedFeatureHead) &&
    (!worktreeCompleted || teardownCompleted) &&
    (!branchCompleted || worktreeCompleted) &&
    (!worktreeCompleted || branchHeadPresent) &&
    (!branchHeadPresent ||
      branchHead === null ||
      (typeof branchHead === 'string' && FULL_COMMIT.test(branchHead))) &&
    Number.isSafeInteger(record.revision) &&
    Number(record.revision) >= 0;
  if (!valid) return invalidRecord();

  return ok(
    clonePendingCleanup({
      version: '1',
      cleanupId: String(record.cleanupId),
      verificationRunId: String(record.verificationRunId),
      attempt: Number(record.attempt),
      projectId: String(record.projectId),
      workspaceId: String(record.workspaceId),
      target: { path: String(target.path), machine: targetMachine },
      featureTarget: {
        workspaceId: String(featureTarget.workspaceId),
        path: String(featureTarget.path),
        machine: featureMachine,
      },
      branchName: String(record.branchName),
      baseCommit: String(record.baseCommit),
      expectedFeatureHead: String(record.expectedFeatureHead),
      teardownRequired,
      ...(branchHeadPresent ? { branchHead: branchHead as string | null } : {}),
      completed: {
        teardown: teardownCompleted,
        worktree: worktreeCompleted,
        branch: branchCompleted,
      },
      revision: Number(record.revision),
    })
  );
}

export function clonePendingCleanup(record: CleanRoomPendingCleanup): CleanRoomPendingCleanup {
  return {
    ...record,
    target: {
      ...record.target,
      machine: { ...record.target.machine },
    },
    featureTarget: {
      ...record.featureTarget,
      machine: { ...record.featureTarget.machine },
    },
    completed: { ...record.completed },
  };
}

export const cleanRoomCleanupJournal = createInMemoryCleanRoomCleanupJournal();

function parseMachine(candidate: unknown): MachineRef | undefined {
  if (!isPlainObject(candidate)) return undefined;
  if (candidate.kind === 'local' && hasExactKeys(candidate, ['kind'])) {
    return { kind: 'local' };
  }
  if (
    candidate.kind === 'ssh' &&
    hasExactKeys(candidate, ['kind', 'connectionId']) &&
    boundedString(candidate.connectionId, 256)
  ) {
    return { kind: 'ssh', connectionId: candidate.connectionId };
  }
  return undefined;
}

function sameMachine(left: MachineRef, right: MachineRef): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'local' || (right.kind === 'ssh' && left.connectionId === right.connectionId))
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.has(key));
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
  );
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function invalidRecord(): Result<never, CleanRoomCleanupRecordError> {
  return err({
    type: 'invalid-cleanup-record',
    message: 'Clean-room cleanup record could not be validated.',
  });
}
