import { err, ok, type Result } from '@emdash/shared';
import type { IExecutionContext } from '@main/core/execution-context/types';

const FULL_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const GIT_TIMEOUT_MS = 120_000;

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
  | { type: 'fix-integration-failed'; message: string }
  | { type: 'git-failed'; operation: string; message: string };

export class FeatureSnapshotService {
  constructor(private readonly ctx: IExecutionContext) {}

  async capture(input: {
    featurePath: string;
    baseCommit: string;
    expectedFeatureHead: string;
  }): Promise<Result<FeatureSnapshot, FeatureSnapshotError>> {
    const base = await this.validateCommit(input.baseCommit, 'base');
    if (!base.success) return base;
    const feature = await this.validateCommit(input.expectedFeatureHead, 'expected-feature-head');
    if (!feature.success) return feature;

    const head = await this.readHead(input.featurePath);
    if (!head.success) return head;
    if (head.data !== feature.data) {
      return err({ type: 'feature-head-drift', expected: feature.data, actual: head.data });
    }

    const clean = await this.requireClean(input.featurePath);
    if (!clean.success) return clean;

    try {
      await this.git(input.featurePath, ['merge-base', '--is-ancestor', base.data, feature.data]);
    } catch {
      return err({
        type: 'base-not-ancestor',
        baseCommit: base.data,
        expectedFeatureHead: feature.data,
      });
    }

    let replayCommits: string[];
    try {
      const result = await this.git(input.featurePath, [
        'rev-list',
        '--reverse',
        '--ancestry-path',
        `${base.data}..${feature.data}`,
      ]);
      replayCommits = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return err({
        type: 'git-failed',
        operation: 'resolve-replay-range',
        message: 'Failed to resolve the reviewed checkpoint range.',
      });
    }

    let expectedParent = base.data;
    for (const commit of replayCommits) {
      try {
        const result = await this.git(input.featurePath, [
          'rev-list',
          '--parents',
          '-n',
          '1',
          commit,
        ]);
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
      } catch {
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
  }): Promise<Result<{ replayedThroughCommit: string }, FeatureSnapshotError>> {
    const head = await this.readHead(input.verificationPath);
    if (!head.success) return head;
    if (head.data !== input.snapshot.baseCommit) {
      return err({
        type: 'replay-base-mismatch',
        expected: input.snapshot.baseCommit,
        actual: head.data,
      });
    }

    for (const commit of input.snapshot.replayCommits) {
      try {
        await this.git(input.verificationPath, ['cherry-pick', '--ff', commit]);
      } catch {
        await this.git(input.verificationPath, ['cherry-pick', '--abort']).catch(() => {});
        return err({
          type: 'replay-conflict',
          commit,
          message: 'The reviewed checkpoint range could not be replayed cleanly.',
        });
      }
    }

    const replayHead = await this.readHead(input.verificationPath);
    if (!replayHead.success) return replayHead;
    if (replayHead.data !== input.snapshot.expectedFeatureHead) {
      return err({
        type: 'replay-head-mismatch',
        expected: input.snapshot.expectedFeatureHead,
        actual: replayHead.data,
      });
    }

    return ok({ replayedThroughCommit: input.snapshot.expectedFeatureHead });
  }

  async integrateFix(input: {
    featurePath: string;
    expectedFeatureHead: string;
    fixCommit: string;
  }): Promise<Result<{ featureHead: string }, FeatureSnapshotError>> {
    const expected = await this.validateCommit(input.expectedFeatureHead, 'expected-feature-head');
    if (!expected.success) return expected;
    const fix = await this.validateCommit(input.fixCommit, 'fix');
    if (!fix.success) return fix;

    try {
      const parentResult = await this.git(input.featurePath, [
        'rev-list',
        '--parents',
        '-n',
        '1',
        fix.data,
      ]);
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
    } catch {
      return err({
        type: 'fix-integration-failed',
        message: 'The clean-room fix parent could not be validated.',
      });
    }

    const clean = await this.requireClean(input.featurePath);
    if (!clean.success) return clean;
    const guarded = await this.requireHead(input.featurePath, expected.data);
    if (!guarded.success) return guarded;

    try {
      // Git's ref update is the optimistic guard: a concurrent divergent head cannot fast-forward.
      await this.git(input.featurePath, ['merge', '--ff-only', fix.data]);
    } catch {
      return err({
        type: 'fix-integration-failed',
        message: 'The clean-room fix could not be integrated without conflicts.',
      });
    }

    const integrated = await this.readHead(input.featurePath);
    if (!integrated.success) return integrated;
    return ok({ featureHead: integrated.data });
  }

  private async validateCommit(
    commit: string,
    role: 'base' | 'expected-feature-head' | 'fix'
  ): Promise<Result<string, FeatureSnapshotError>> {
    if (!FULL_COMMIT.test(commit)) return err({ type: 'invalid-commit', role, commit });
    try {
      const result = await this.ctx.exec('git', ['rev-parse', '--verify', `${commit}^{commit}`], {
        timeout: GIT_TIMEOUT_MS,
      });
      const resolved = result.stdout.trim();
      if (!FULL_COMMIT.test(resolved)) throw new Error('not a commit');
      return ok(resolved);
    } catch {
      return err({ type: 'commit-not-found', role, commit });
    }
  }

  private async readHead(path: string): Promise<Result<string, FeatureSnapshotError>> {
    try {
      const result = await this.git(path, ['rev-parse', 'HEAD']);
      return ok(result.stdout.trim());
    } catch {
      return err({
        type: 'git-failed',
        operation: 'read-head',
        message: 'Failed to read the workspace head.',
      });
    }
  }

  private async requireHead(
    path: string,
    expected: string
  ): Promise<Result<void, FeatureSnapshotError>> {
    const head = await this.readHead(path);
    if (!head.success) return head;
    return head.data === expected
      ? ok()
      : err({ type: 'feature-head-drift', expected, actual: head.data });
  }

  private async requireClean(path: string): Promise<Result<void, FeatureSnapshotError>> {
    try {
      const result = await this.git(path, ['status', '--porcelain', '--untracked-files=normal']);
      return result.stdout.trim()
        ? err({ type: 'feature-workspace-dirty', message: 'Feature workspace must be clean.' })
        : ok();
    } catch {
      return err({
        type: 'git-failed',
        operation: 'read-status',
        message: 'Failed to verify feature workspace cleanliness.',
      });
    }
  }

  private git(path: string, args: string[]) {
    return this.ctx.exec('git', ['-C', path, ...args], { timeout: GIT_TIMEOUT_MS });
  }
}
