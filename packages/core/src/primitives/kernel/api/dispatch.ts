import { modesCompatible, type ClaimMode } from './claim-modes';
import type { ResourceClaim } from './resources';

export class RunningClaims {
  private readonly byOperation = new Map<string, ResourceClaim[]>();
  private readonly held = new Map<string, Map<ClaimMode, Set<string>>>();

  compatible(claims: readonly ResourceClaim[], ignoring: ReadonlySet<string> = new Set()): boolean {
    return this.blockers(claims, ignoring).length === 0;
  }

  blockers(claims: readonly ResourceClaim[], ignoring: ReadonlySet<string> = new Set()): string[] {
    const blockers = new Set<string>();

    for (const claim of claims) {
      const modes = this.held.get(claimLockKey(claim));
      if (!modes) {
        continue;
      }

      for (const [heldMode, holders] of modes) {
        if (modesCompatible(heldMode, claim.mode)) {
          continue;
        }
        for (const holder of holders) {
          if (!ignoring.has(holder)) {
            blockers.add(holder);
          }
        }
      }
    }

    return [...blockers].sort();
  }

  acquire(operationId: string, claims: readonly ResourceClaim[]): void {
    this.release(operationId);
    this.byOperation.set(operationId, [...claims]);

    for (const claim of claims) {
      const lockKey = claimLockKey(claim);
      const modes = this.held.get(lockKey) ?? new Map<ClaimMode, Set<string>>();
      const holders = modes.get(claim.mode) ?? new Set<string>();
      holders.add(operationId);
      modes.set(claim.mode, holders);
      this.held.set(lockKey, modes);
    }
  }

  release(operationId: string): void {
    const claims = this.byOperation.get(operationId);
    if (!claims) {
      return;
    }

    for (const claim of claims) {
      const lockKey = claimLockKey(claim);
      const modes = this.held.get(lockKey);
      const holders = modes?.get(claim.mode);
      holders?.delete(operationId);
      if (holders?.size === 0) {
        modes?.delete(claim.mode);
      }
      if (modes?.size === 0) {
        this.held.delete(lockKey);
      }
    }

    this.byOperation.delete(operationId);
  }

  heldBy(operationId: string): ResourceClaim[] {
    return [...(this.byOperation.get(operationId) ?? [])];
  }
}

export type DispatchDeferredReason = 'not-before' | 'gated';

export interface PendingOperation {
  id: string;
  seq: number;
  claims: ResourceClaim[];
  ancestors: ReadonlySet<string>;
  start(): void;
}

export interface DispatchPassReport {
  started: string[];
  skipped: Array<{
    id: string;
    blockedBy: string[];
    barredOn: string[];
  }>;
  deferred: Array<{
    id: string;
    reason: DispatchDeferredReason;
  }>;
}

export function dispatchPass(
  pending: readonly PendingOperation[],
  running: RunningClaims,
  gate?: (op: PendingOperation) => boolean
): DispatchPassReport {
  const barred = new Map<string, ClaimMode[]>();
  const report: DispatchPassReport = { started: [], skipped: [], deferred: [] };

  for (const op of [...pending].sort((a, b) => a.seq - b.seq)) {
    if (gate && !gate(op)) {
      report.deferred.push({ id: op.id, reason: 'gated' });
      continue;
    }

    const barredOn = op.claims
      .filter((claim) =>
        (barred.get(claimLockKey(claim)) ?? []).some((mode) => !modesCompatible(mode, claim.mode))
      )
      .map(displayClaimKey);
    const blockedBy = running.blockers(op.claims, op.ancestors);

    if (barredOn.length > 0 || blockedBy.length > 0) {
      for (const claim of op.claims) {
        const lockKey = claimLockKey(claim);
        const modes = barred.get(lockKey) ?? [];
        modes.push(claim.mode);
        barred.set(lockKey, modes);
      }
      report.skipped.push({ id: op.id, blockedBy, barredOn });
      continue;
    }

    running.acquire(op.id, op.claims);
    op.start();
    report.started.push(op.id);
  }

  return report;
}

export function waitingOn(
  opId: string,
  report: DispatchPassReport
): { blockedBy: string[]; barredOn: string[] } | undefined {
  const entry = report.skipped.find((skipped) => skipped.id === opId);
  if (!entry) {
    return undefined;
  }
  return { blockedBy: entry.blockedBy, barredOn: entry.barredOn };
}

function claimLockKey(claim: ResourceClaim): string {
  return `${claim.resource}\u0000${claim.key}`;
}

function displayClaimKey(claim: ResourceClaim): string {
  return `${claim.resource}:${claim.key}`;
}
