import { err, ok, type Result } from '@emdash/shared';
import type { IExecutionContext } from '@main/core/execution-context/types';

const FULL_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const GIT_TIMEOUT_MS = 120_000;
const RECOVERY_MAX_ATTEMPTS = 8;
const RECOVERY_DEADLINE_MS = 30_000;

export type FeatureSnapshot = {
  baseCommit: string;
  expectedFeatureHead: string;
  replayCommits: string[];
};

export type FeatureSnapshotError =
  | { type: 'invalid-commit'; role: 'base' | 'expected-feature-head' | 'fix'; commit: string }
  | { type: 'commit-not-found'; role: 'base' | 'expected-feature-head' | 'fix'; commit: string }
  | { type: 'feature-head-drift'; expected: string; actual: string }
  | { type: 'feature-workspace-dirty'; message: string }
  | { type: 'base-not-ancestor'; baseCommit: string; expectedFeatureHead: string }
  | { type: 'non-linear-replay'; message: string }
  | { type: 'replay-base-mismatch'; expected: string; actual: string }
  | { type: 'replay-head-mismatch'; expected: string; actual: string }
  | { type: 'replay-conflict'; commit: string; message: string }
  | { type: 'replay-recovery-required'; commit: string; message: string }
  | { type: 'fix-integration-failed'; message: string }
  | { type: 'fix-integration-recovery-required'; message: string }
  | { type: 'cancelled'; message: string }
  | { type: 'deadline-exceeded'; message: string }
  | { type: 'git-failed'; operation: string; message: string };

export type FeatureSnapshotOperationControl = {
  signal?: AbortSignal;
  deadlineAt?: number;
};

class FeatureSnapshotOperationStopped extends Error {
  constructor(
    readonly failure: Extract<FeatureSnapshotError, { type: 'cancelled' | 'deadline-exceeded' }>
  ) {
    super(failure.message);
  }
}

export class FeatureSnapshotService {
  constructor(private readonly ctx: IExecutionContext) {}

  async capture(input: {
    featurePath: string;
    baseCommit: string;
    expectedFeatureHead: string;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<FeatureSnapshot, FeatureSnapshotError>> {
    const active = operationFailure(input);
    if (active) return err(active);
    const base = await this.validateCommit(input.featurePath, input.baseCommit, 'base', input);
    if (!base.success) return base;
    const feature = await this.validateCommit(
      input.featurePath,
      input.expectedFeatureHead,
      'expected-feature-head',
      input
    );
    if (!feature.success) return feature;

    const head = await this.readHead(input.featurePath, input);
    if (!head.success) return head;
    if (head.data !== feature.data) {
      return err({ type: 'feature-head-drift', expected: feature.data, actual: head.data });
    }

    const clean = await this.requireClean(input.featurePath, input);
    if (!clean.success) return clean;

    try {
      await this.git(
        input.featurePath,
        ['merge-base', '--is-ancestor', base.data, feature.data],
        input
      );
    } catch (cause) {
      const stopped = stoppedFailure(cause, input);
      if (stopped) return err(stopped);
      return err({
        type: 'base-not-ancestor',
        baseCommit: base.data,
        expectedFeatureHead: feature.data,
      });
    }

    let replayCommits: string[];
    try {
      const result = await this.git(
        input.featurePath,
        ['rev-list', '--reverse', '--ancestry-path', `${base.data}..${feature.data}`],
        input
      );
      replayCommits = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (cause) {
      const stopped = stoppedFailure(cause, input);
      if (stopped) return err(stopped);
      return err({
        type: 'git-failed',
        operation: 'resolve-replay-range',
        message: 'Failed to resolve the reviewed checkpoint range.',
      });
    }

    let expectedParent = base.data;
    for (const commit of replayCommits) {
      try {
        const result = await this.git(
          input.featurePath,
          ['rev-list', '--parents', '-n', '1', commit],
          input
        );
        const [resolvedCommit, ...parents] = result.stdout.trim().split(/\s+/);
        if (
          resolvedCommit.toLowerCase() !== commit.toLowerCase() ||
          parents.length !== 1 ||
          parents[0].toLowerCase() !== expectedParent.toLowerCase()
        ) {
          return err({
            type: 'non-linear-replay',
            message: 'The reviewed checkpoint range must be linear.',
          });
        }
      } catch (cause) {
        const stopped = stoppedFailure(cause, input);
        if (stopped) return err(stopped);
        return err({
          type: 'git-failed',
          operation: 'validate-replay-range',
          message: 'Failed to validate the reviewed checkpoint range.',
        });
      }
      expectedParent = commit;
    }

    return ok({
      baseCommit: base.data,
      expectedFeatureHead: feature.data,
      replayCommits,
    });
  }

  async replay(input: {
    verificationPath: string;
    snapshot: FeatureSnapshot;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<{ replayedThroughCommit: string }, FeatureSnapshotError>> {
    const active = operationFailure(input);
    if (active) return err(active);
    const head = await this.readHead(input.verificationPath, input);
    if (!head.success) return head;
    if (head.data !== input.snapshot.baseCommit) {
      return err({
        type: 'replay-base-mismatch',
        expected: input.snapshot.baseCommit,
        actual: head.data,
      });
    }

    let previousHead = input.snapshot.baseCommit;
    for (const commit of input.snapshot.replayCommits) {
      const replayState = await this.readReplayState(input.verificationPath, input);
      if (!replayState.success) return replayState;
      const branchRef = await this.readReplayRef(input.verificationPath, input);
      if (!branchRef.success) return branchRef;
      try {
        await this.git(input.verificationPath, ['cherry-pick', '--ff', commit], input);
      } catch (cause) {
        const stopped = stoppedFailure(cause, input);
        const observedHead = await this.readHeadForRecovery(input.verificationPath);
        let restored = false;
        if (observedHead.success && observedHead.data === commit) {
          restored = await this.rollbackReplayStep(
            input.verificationPath,
            branchRef.data,
            previousHead,
            commit
          );
        } else if (observedHead.success && observedHead.data === previousHead) {
          await this.gitForCleanup(input.verificationPath, ['cherry-pick', '--abort']).catch(
            () => {}
          );
          const afterAbort = await this.readHeadForRecovery(input.verificationPath);
          restored = afterAbort.success && afterAbort.data === previousHead;
        }
        if (restored) {
          const restoredState = await this.readReplayStateForRecovery(input.verificationPath);
          restored = restoredState.success && restoredState.data === replayState.data;
        }
        if (!restored) {
          return err({
            type: 'replay-recovery-required',
            commit,
            message: 'Replay state changed ambiguously and requires explicit recovery.',
          });
        }
        if (stopped) return err(stopped);
        return err({
          type: 'replay-conflict',
          commit,
          message: 'The reviewed checkpoint range could not be replayed cleanly.',
        });
      }
      const stoppedAfterMutation = operationFailure(input);
      if (stoppedAfterMutation) {
        return this.rollbackStoppedReplayStep({
          path: input.verificationPath,
          branchRef: branchRef.data,
          previousHead,
          appliedCommit: commit,
          expectedState: replayState.data,
          stopped: stoppedAfterMutation,
        });
      }
      const replayStepHead = await this.readHead(input.verificationPath, input);
      if (!replayStepHead.success) {
        if (
          replayStepHead.error.type === 'cancelled' ||
          replayStepHead.error.type === 'deadline-exceeded'
        ) {
          return this.rollbackStoppedReplayStep({
            path: input.verificationPath,
            branchRef: branchRef.data,
            previousHead,
            appliedCommit: commit,
            expectedState: replayState.data,
            stopped: replayStepHead.error,
          });
        }
        return replayStepHead;
      }
      const stoppedAfterRead = operationFailure(input);
      if (stoppedAfterRead) {
        return this.rollbackStoppedReplayStep({
          path: input.verificationPath,
          branchRef: branchRef.data,
          previousHead,
          appliedCommit: commit,
          expectedState: replayState.data,
          stopped: stoppedAfterRead,
        });
      }
      if (replayStepHead.data !== commit) {
        return err({
          type: 'replay-head-mismatch',
          expected: commit,
          actual: replayStepHead.data,
        });
      }
      previousHead = commit;
    }

    if (previousHead !== input.snapshot.expectedFeatureHead) {
      return err({
        type: 'replay-head-mismatch',
        expected: input.snapshot.expectedFeatureHead,
        actual: previousHead,
      });
    }

    return ok({ replayedThroughCommit: input.snapshot.expectedFeatureHead });
  }

  async integrateFix(input: {
    featurePath: string;
    expectedFeatureHead: string;
    fixCommit: string;
    signal?: AbortSignal;
    deadlineAt?: number;
  }): Promise<Result<{ featureHead: string }, FeatureSnapshotError>> {
    const active = operationFailure(input);
    if (active) return err(active);
    const expected = await this.validateCommit(
      input.featurePath,
      input.expectedFeatureHead,
      'expected-feature-head',
      input
    );
    if (!expected.success) return expected;
    const fix = await this.validateCommit(input.featurePath, input.fixCommit, 'fix', input);
    if (!fix.success) return fix;

    try {
      const parentResult = await this.git(
        input.featurePath,
        ['rev-list', '--parents', '-n', '1', fix.data],
        input
      );
      const [resolvedFix, ...parents] = parentResult.stdout.trim().split(/\s+/);
      if (
        resolvedFix.toLowerCase() !== fix.data.toLowerCase() ||
        parents.length !== 1 ||
        parents[0].toLowerCase() !== expected.data.toLowerCase()
      ) {
        return err({
          type: 'fix-integration-failed',
          message:
            'The clean-room fix must be a single commit directly on the expected feature head.',
        });
      }
    } catch (cause) {
      const stopped = stoppedFailure(cause, input);
      if (stopped) return err(stopped);
      return err({
        type: 'fix-integration-failed',
        message: 'The clean-room fix parent could not be validated.',
      });
    }

    const clean = await this.requireClean(input.featurePath, input);
    if (!clean.success) return clean;
    const guarded = await this.requireHead(input.featurePath, expected.data, input);
    if (!guarded.success) return guarded;

    const branchRef = await this.readBranchRef(input.featurePath, input);
    if (!branchRef.success) return branchRef;

    try {
      await this.git(
        input.featurePath,
        [
          'update-ref',
          '-m',
          'emdash: integrate Loop correction',
          branchRef.data,
          fix.data,
          expected.data,
        ],
        input
      );
    } catch (cause) {
      const stopped = stoppedFailure(cause, input);
      const observedRef = await this.readRefForRecovery(input.featurePath, branchRef.data);
      if (!observedRef.success) return err(recoveryRequired());
      if (observedRef.data === fix.data) {
        const rolledBack = await this.rollbackAmbiguousRefUpdate(
          input.featurePath,
          branchRef.data,
          expected.data,
          fix.data
        );
        if (!rolledBack) return err(recoveryRequired());
        if (stopped) return err(stopped);
      } else if (observedRef.data !== expected.data) {
        return err({
          type: 'fix-integration-failed',
          message: 'The feature branch moved before the clean-room fix could be integrated.',
        });
      } else if (stopped) {
        return err(stopped);
      }
      return err({
        type: 'fix-integration-failed',
        message: 'The feature branch moved before the clean-room fix could be integrated.',
      });
    }

    const owned = await this.readHeadForRecovery(input.featurePath);
    if (!owned.success || owned.data !== fix.data) {
      const ref = await this.readRefForRecovery(input.featurePath, branchRef.data);
      if (ref.success && ref.data === fix.data) {
        const rolledBack = await this.rollbackAmbiguousRefUpdate(
          input.featurePath,
          branchRef.data,
          expected.data,
          fix.data
        );
        return rolledBack
          ? err({
              type: 'fix-integration-failed',
              message: 'The checked-out feature branch changed before synchronization.',
            })
          : err(recoveryRequired());
      }
      return err({
        type: 'fix-integration-failed',
        message: 'The feature branch moved before synchronization.',
      });
    }

    try {
      await this.git(input.featurePath, ['read-tree', '-u', '-m', expected.data, fix.data], input);
    } catch (cause) {
      const rolledBack = await this.rollbackIntegration(
        input.featurePath,
        branchRef.data,
        expected.data,
        fix.data
      );
      if (!rolledBack) return err(recoveryRequired());
      const stopped = stoppedFailure(cause, input);
      return stopped
        ? err(stopped)
        : err({
            type: 'fix-integration-failed',
            message: 'The clean-room fix could not be synchronized without overwriting changes.',
          });
    }

    const verified = await this.verifyIntegratedState(
      input.featurePath,
      branchRef.data,
      fix.data,
      input
    );
    if (verified.success) return ok({ featureHead: fix.data });

    const concurrentlyMoved = await this.readHeadForRecovery(input.featurePath);
    if (concurrentlyMoved.success && concurrentlyMoved.data !== fix.data) {
      const restored = await this.restoreWorktreeToCurrentHead(input.featurePath, fix.data);
      return restored
        ? err({
            type: 'fix-integration-failed',
            message: 'The feature branch moved while the clean-room fix was being synchronized.',
          })
        : err(recoveryRequired());
    }

    const rolledBack = await this.rollbackIntegration(
      input.featurePath,
      branchRef.data,
      expected.data,
      fix.data
    );
    return rolledBack ? verified : err(recoveryRequired());
  }

  private async validateCommit(
    path: string,
    commit: string,
    role: 'base' | 'expected-feature-head' | 'fix',
    control: FeatureSnapshotOperationControl
  ): Promise<Result<string, FeatureSnapshotError>> {
    if (!FULL_COMMIT.test(commit)) return err({ type: 'invalid-commit', role, commit });
    try {
      const result = await this.git(path, ['rev-parse', '--verify', `${commit}^{commit}`], control);
      const resolved = result.stdout.trim();
      if (!FULL_COMMIT.test(resolved)) throw new Error('not a commit');
      return ok(resolved);
    } catch (cause) {
      const stopped = stoppedFailure(cause, control);
      if (stopped) return err(stopped);
      return err({ type: 'commit-not-found', role, commit });
    }
  }

  private async readHead(
    path: string,
    control: FeatureSnapshotOperationControl
  ): Promise<Result<string, FeatureSnapshotError>> {
    try {
      const result = await this.git(path, ['rev-parse', 'HEAD'], control);
      return ok(result.stdout.trim());
    } catch (cause) {
      const stopped = stoppedFailure(cause, control);
      if (stopped) return err(stopped);
      return err({
        type: 'git-failed',
        operation: 'read-head',
        message: 'Failed to read the workspace head.',
      });
    }
  }

  private async requireHead(
    path: string,
    expected: string,
    control: FeatureSnapshotOperationControl
  ): Promise<Result<void, FeatureSnapshotError>> {
    const head = await this.readHead(path, control);
    if (!head.success) return head;
    return head.data === expected
      ? ok()
      : err({ type: 'feature-head-drift', expected, actual: head.data });
  }

  private async requireClean(
    path: string,
    control: FeatureSnapshotOperationControl
  ): Promise<Result<void, FeatureSnapshotError>> {
    try {
      const result = await this.git(
        path,
        ['status', '--porcelain', '--untracked-files=normal'],
        control
      );
      return result.stdout.trim()
        ? err({ type: 'feature-workspace-dirty', message: 'Feature workspace must be clean.' })
        : ok();
    } catch (cause) {
      const stopped = stoppedFailure(cause, control);
      if (stopped) return err(stopped);
      return err({
        type: 'git-failed',
        operation: 'read-status',
        message: 'Failed to verify feature workspace cleanliness.',
      });
    }
  }

  private async readBranchRef(
    path: string,
    control: FeatureSnapshotOperationControl
  ): Promise<Result<string, FeatureSnapshotError>> {
    try {
      const result = await this.git(path, ['symbolic-ref', '--quiet', 'HEAD'], control);
      const ref = result.stdout.trim();
      return ref.startsWith('refs/heads/')
        ? ok(ref)
        : err({
            type: 'fix-integration-failed',
            message: 'The feature workspace must have a checked-out branch.',
          });
    } catch (cause) {
      const stopped = stoppedFailure(cause, control);
      return err(
        stopped ?? {
          type: 'fix-integration-failed',
          message: 'The feature workspace must have a checked-out branch.',
        }
      );
    }
  }

  private async verifyIntegratedState(
    path: string,
    branchRef: string,
    fixCommit: string,
    control: FeatureSnapshotOperationControl
  ): Promise<Result<void, FeatureSnapshotError>> {
    const currentRef = await this.readBranchRef(path, control);
    if (!currentRef.success) return currentRef;
    if (currentRef.data !== branchRef) return err(recoveryRequired());
    const head = await this.readHead(path, control);
    if (!head.success) return head;
    if (head.data !== fixCommit) return err(recoveryRequired());
    return this.requireClean(path, control);
  }

  private async readHeadForRecovery(path: string): Promise<Result<string, FeatureSnapshotError>> {
    try {
      const result = await this.gitForCleanup(path, ['rev-parse', 'HEAD']);
      return ok(result.stdout.trim());
    } catch {
      return err(recoveryRequired());
    }
  }

  private async readRefForRecovery(
    path: string,
    branchRef: string
  ): Promise<Result<string, FeatureSnapshotError>> {
    try {
      const result = await this.gitForCleanup(path, ['rev-parse', '--verify', branchRef]);
      return ok(result.stdout.trim());
    } catch {
      return err(recoveryRequired());
    }
  }

  private async rollbackAmbiguousRefUpdate(
    path: string,
    branchRef: string,
    expectedFeatureHead: string,
    fixCommit: string
  ): Promise<boolean> {
    try {
      await this.gitForCleanup(path, [
        'update-ref',
        '-m',
        'emdash: roll back ambiguous Loop correction',
        branchRef,
        expectedFeatureHead,
        fixCommit,
      ]);
    } catch {
      const ref = await this.readRefForRecovery(path, branchRef);
      if (!ref.success || ref.data !== expectedFeatureHead) return false;
    }
    const ref = await this.readRefForRecovery(path, branchRef);
    return ref.success && ref.data === expectedFeatureHead;
  }

  private async rollbackReplayStep(
    path: string,
    branchRef: string,
    previousHead: string,
    appliedCommit: string
  ): Promise<boolean> {
    const symbolic = await this.readBranchRefForRecovery(path);
    if (!symbolic.success || symbolic.data !== branchRef) return false;
    try {
      await this.gitForCleanup(path, [
        'update-ref',
        '-m',
        'emdash: roll back ambiguous Loop replay',
        branchRef,
        previousHead,
        appliedCommit,
      ]);
    } catch {
      const ref = await this.readRefForRecovery(path, branchRef);
      if (!ref.success || ref.data !== previousHead) return false;
    }
    return this.restoreWorktreeToCurrentHead(path, appliedCommit);
  }

  private async rollbackStoppedReplayStep(input: {
    path: string;
    branchRef: string;
    previousHead: string;
    appliedCommit: string;
    expectedState: string;
    stopped: Extract<FeatureSnapshotError, { type: 'cancelled' | 'deadline-exceeded' }>;
  }): Promise<Result<never, FeatureSnapshotError>> {
    const rolledBack = await this.rollbackReplayStep(
      input.path,
      input.branchRef,
      input.previousHead,
      input.appliedCommit
    );
    const restoredState = rolledBack
      ? await this.readReplayStateForRecovery(input.path)
      : undefined;
    if (!restoredState?.success || restoredState.data !== input.expectedState) {
      return err({
        type: 'replay-recovery-required',
        commit: input.appliedCommit,
        message: 'Replay state changed ambiguously and requires explicit recovery.',
      });
    }
    return err(input.stopped);
  }

  private async readReplayRef(
    path: string,
    control: FeatureSnapshotOperationControl
  ): Promise<Result<string, FeatureSnapshotError>> {
    try {
      const result = await this.git(path, ['symbolic-ref', '--quiet', 'HEAD'], control);
      const ref = result.stdout.trim();
      return ok(ref.startsWith('refs/heads/') ? ref : 'HEAD');
    } catch (cause) {
      const stopped = stoppedFailure(cause, control);
      return stopped ? err(stopped) : ok('HEAD');
    }
  }

  private async readReplayState(
    path: string,
    control: FeatureSnapshotOperationControl
  ): Promise<Result<string, FeatureSnapshotError>> {
    try {
      const status = await this.git(
        path,
        ['status', '--porcelain=v1', '--untracked-files=normal'],
        control
      );
      const worktree = await this.git(path, ['diff', '--binary'], control);
      const index = await this.git(path, ['diff', '--cached', '--binary'], control);
      return ok(`${status.stdout}\0${worktree.stdout}\0${index.stdout}`);
    } catch (cause) {
      const stopped = stoppedFailure(cause, control);
      return err(
        stopped ?? {
          type: 'git-failed',
          operation: 'capture-replay-state',
          message: 'Failed to attest replay state before mutation.',
        }
      );
    }
  }

  private async readReplayStateForRecovery(
    path: string
  ): Promise<Result<string, FeatureSnapshotError>> {
    try {
      const status = await this.gitForCleanup(path, [
        'status',
        '--porcelain=v1',
        '--untracked-files=normal',
      ]);
      const worktree = await this.gitForCleanup(path, ['diff', '--binary']);
      const index = await this.gitForCleanup(path, ['diff', '--cached', '--binary']);
      return ok(`${status.stdout}\0${worktree.stdout}\0${index.stdout}`);
    } catch {
      return err({
        type: 'git-failed',
        operation: 'attest-replay-recovery',
        message: 'Failed to attest replay recovery state.',
      });
    }
  }

  private async rollbackIntegration(
    path: string,
    branchRef: string,
    expectedFeatureHead: string,
    fixCommit: string
  ): Promise<boolean> {
    const head = await this.readHeadForRecovery(path);
    if (!head.success || head.data !== fixCommit) return false;
    const symbolic = await this.readBranchRefForRecovery(path);
    if (!symbolic.success || symbolic.data !== branchRef) return false;
    try {
      await this.gitForCleanup(path, [
        'update-ref',
        '-m',
        'emdash: roll back Loop correction',
        branchRef,
        expectedFeatureHead,
        fixCommit,
      ]);
    } catch {
      const ref = await this.readRefForRecovery(path, branchRef);
      if (!ref.success || ref.data !== expectedFeatureHead) return false;
    }
    const ref = await this.readRefForRecovery(path, branchRef);
    if (!ref.success || ref.data !== expectedFeatureHead) return false;
    return this.restoreWorktreeToCurrentHead(path, fixCommit);
  }

  private async restoreWorktreeToCurrentHead(path: string, sourceTree: string): Promise<boolean> {
    let currentSource = sourceTree;
    const recoveryDeadline = Date.now() + RECOVERY_DEADLINE_MS;
    for (
      let attempt = 0;
      attempt < RECOVERY_MAX_ATTEMPTS && Date.now() < recoveryDeadline;
      attempt += 1
    ) {
      const currentHead = await this.readHeadForRecovery(path);
      if (!currentHead.success || !FULL_COMMIT.test(currentHead.data)) return false;
      if (await this.trackedStateMatches(path, currentHead.data)) return true;
      try {
        await this.gitForCleanup(path, ['read-tree', '-u', '-m', currentSource, currentHead.data]);
      } catch {
        return false;
      }
      currentSource = currentHead.data;
    }
    const finalHead = await this.readHeadForRecovery(path);
    return finalHead.success && (await this.trackedStateMatches(path, finalHead.data));
  }

  private async trackedStateMatches(path: string, commit: string): Promise<boolean> {
    try {
      await this.gitForCleanup(path, ['diff', '--quiet']);
      await this.gitForCleanup(path, ['diff', '--cached', '--quiet', commit]);
      return true;
    } catch {
      return false;
    }
  }

  private async readBranchRefForRecovery(
    path: string
  ): Promise<Result<string, FeatureSnapshotError>> {
    try {
      const result = await this.gitForCleanup(path, ['symbolic-ref', '--quiet', 'HEAD']);
      const ref = result.stdout.trim();
      return ref.startsWith('refs/heads/') ? ok(ref) : err(recoveryRequired());
    } catch {
      return err(recoveryRequired());
    }
  }

  private git(path: string, args: string[], control: FeatureSnapshotOperationControl) {
    const stopped = operationFailure(control);
    if (stopped) throw new FeatureSnapshotOperationStopped(stopped);
    const remaining =
      control.deadlineAt === undefined
        ? GIT_TIMEOUT_MS
        : Math.max(1, Math.min(GIT_TIMEOUT_MS, control.deadlineAt - Date.now()));
    return this.ctx.exec('git', ['-C', path, ...args], {
      timeout: remaining,
      signal: control.signal,
    });
  }

  private gitForCleanup(path: string, args: string[]) {
    return this.ctx.exec('git', ['-C', path, ...args], { timeout: GIT_TIMEOUT_MS });
  }
}

function operationFailure(
  control: FeatureSnapshotOperationControl
): Extract<FeatureSnapshotError, { type: 'cancelled' | 'deadline-exceeded' }> | undefined {
  if (control.signal?.aborted) {
    return { type: 'cancelled', message: 'Feature snapshot operation was cancelled.' };
  }
  if (control.deadlineAt !== undefined && control.deadlineAt <= Date.now()) {
    return { type: 'deadline-exceeded', message: 'Feature snapshot deadline was exceeded.' };
  }
  return undefined;
}

function stoppedFailure(
  cause: unknown,
  control: FeatureSnapshotOperationControl
): Extract<FeatureSnapshotError, { type: 'cancelled' | 'deadline-exceeded' }> | undefined {
  if (cause instanceof FeatureSnapshotOperationStopped) return cause.failure;
  return operationFailure(control);
}

function recoveryRequired(): Extract<
  FeatureSnapshotError,
  { type: 'fix-integration-recovery-required' }
> {
  return {
    type: 'fix-integration-recovery-required',
    message: 'Feature integration state changed concurrently and requires explicit recovery.',
  };
}
