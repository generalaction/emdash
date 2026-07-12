import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { FeatureSnapshotService } from './feature-snapshot-service';

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await new LocalExecutionContext({ root: cwd }).exec('git', args);
  return result.stdout.trim();
}

async function commitFile(
  cwd: string,
  file: string,
  content: string,
  message: string
): Promise<string> {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), content);
  await git(cwd, ['add', file]);
  await git(cwd, ['commit', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

describe('FeatureSnapshotService', () => {
  let rootPath: string;
  let repoPath: string;
  let service: FeatureSnapshotService;
  let baseCommit: string;

  beforeEach(async () => {
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'loop-feature-snapshot-'));
    repoPath = path.join(rootPath, 'repo');
    fs.mkdirSync(repoPath);
    await git(repoPath, ['init']);
    await git(repoPath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    await git(repoPath, ['config', 'user.email', 'test@test.com']);
    await git(repoPath, ['config', 'user.name', 'Test']);
    baseCommit = await commitFile(repoPath, 'base.txt', 'base', 'base');
    service = new FeatureSnapshotService(new LocalExecutionContext({ root: repoPath }));
  });

  afterEach(() => {
    fs.rmSync(rootPath, { recursive: true, force: true });
  });

  async function prepareFix(label: string): Promise<{
    expectedFeatureHead: string;
    fixCommit: string;
  }> {
    const expectedFeatureHead = await commitFile(
      repoPath,
      `${label}-feature.txt`,
      'feature',
      `${label} feature`
    );
    const verificationPath = path.join(rootPath, label);
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      `verify/${label}`,
      verificationPath,
      expectedFeatureHead,
    ]);
    const fixCommit = await commitFile(verificationPath, `${label}-fix.txt`, 'fix', `${label} fix`);
    return { expectedFeatureHead, fixCommit };
  }

  it('captures and replays the exact linear reviewed range in order', async () => {
    await commitFile(repoPath, 'one.txt', 'one', 'one');
    fs.writeFileSync(
      path.join(repoPath, '.emdash.json'),
      JSON.stringify({ scripts: { setup: 'pnpm install' } })
    );
    await git(repoPath, ['add', '.emdash.json']);
    await git(repoPath, ['commit', '-m', 'feature config']);
    const expectedFeatureHead = await git(repoPath, ['rev-parse', 'HEAD']);

    const captured = await service.capture({
      featurePath: repoPath,
      baseCommit,
      expectedFeatureHead,
    });
    expect(captured.success).toBe(true);
    if (!captured.success) throw new Error('expected snapshot');
    expect(captured.data.replayCommits).toHaveLength(2);

    const verificationPath = path.join(rootPath, 'verification');
    await git(repoPath, ['worktree', 'add', '-b', 'verify/replay', verificationPath, baseCommit]);
    const replayed = await service.replay({
      verificationPath,
      snapshot: captured.data,
    });

    expect(replayed).toEqual({
      success: true,
      data: { replayedThroughCommit: expectedFeatureHead },
    });
    expect(await git(verificationPath, ['rev-parse', 'HEAD'])).toBe(expectedFeatureHead);
    expect(fs.readFileSync(path.join(verificationPath, 'one.txt'), 'utf8')).toBe('one');
    expect(
      JSON.parse(fs.readFileSync(path.join(verificationPath, '.emdash.json'), 'utf8'))
    ).toEqual({ scripts: { setup: 'pnpm install' } });
  });

  it('rejects an invalid expected commit and feature-head drift before creation', async () => {
    const actualHead = await commitFile(repoPath, 'feature.txt', 'feature', 'feature');

    await expect(
      service.capture({
        featurePath: repoPath,
        baseCommit: 'e'.repeat(40),
        expectedFeatureHead: actualHead,
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'commit-not-found',
        role: 'base',
        commit: 'e'.repeat(40),
      },
    });

    await expect(
      service.capture({
        featurePath: repoPath,
        baseCommit,
        expectedFeatureHead: 'f'.repeat(40),
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'commit-not-found',
        role: 'expected-feature-head',
        commit: 'f'.repeat(40),
      },
    });

    await expect(
      service.capture({
        featurePath: repoPath,
        baseCommit,
        expectedFeatureHead: baseCommit,
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'feature-head-drift',
        expected: baseCommit,
        actual: actualHead,
      },
    });
  });

  it('rejects a dirty feature workspace and a non-linear merge range', async () => {
    fs.writeFileSync(path.join(repoPath, 'base.txt'), 'dirty');
    const dirty = await service.capture({
      featurePath: repoPath,
      baseCommit,
      expectedFeatureHead: baseCommit,
    });
    expect(dirty).toEqual({
      success: false,
      error: { type: 'feature-workspace-dirty', message: 'Feature workspace must be clean.' },
    });
    await git(repoPath, ['checkout', '--', 'base.txt']);

    await git(repoPath, ['checkout', '-b', 'side']);
    await commitFile(repoPath, 'side.txt', 'side', 'side');
    await git(repoPath, ['checkout', 'main']);
    await commitFile(repoPath, 'main.txt', 'main', 'main');
    await git(repoPath, ['merge', '--no-ff', 'side', '-m', 'merge']);
    const mergeHead = await git(repoPath, ['rev-parse', 'HEAD']);

    await expect(
      service.capture({ featurePath: repoPath, baseCommit, expectedFeatureHead: mergeHead })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'non-linear-replay' },
    });
  });

  it('rejects non-ignored untracked source but allows an ignored preserved-style file', async () => {
    fs.writeFileSync(path.join(repoPath, 'new-source.ts'), 'export const value = 1;');
    await expect(
      service.capture({ featurePath: repoPath, baseCommit, expectedFeatureHead: baseCommit })
    ).resolves.toEqual({
      success: false,
      error: { type: 'feature-workspace-dirty', message: 'Feature workspace must be clean.' },
    });
    fs.rmSync(path.join(repoPath, 'new-source.ts'));

    const expectedFeatureHead = await commitFile(
      repoPath,
      '.gitignore',
      '.env.local\n',
      'ignore env'
    );
    fs.writeFileSync(path.join(repoPath, '.env.local'), 'SECRET=approved');

    await expect(
      service.capture({ featurePath: repoPath, baseCommit, expectedFeatureHead })
    ).resolves.toMatchObject({ success: true });
  });

  it('rejects a feature head that is not descended from the frozen base', async () => {
    await git(repoPath, ['checkout', '--orphan', 'unrelated']);
    await git(repoPath, ['rm', '-rf', '.']);
    const unrelatedHead = await commitFile(repoPath, 'unrelated.txt', 'unrelated', 'unrelated');

    await expect(
      service.capture({
        featurePath: repoPath,
        baseCommit,
        expectedFeatureHead: unrelatedHead,
      })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'base-not-ancestor',
        baseCommit,
        expectedFeatureHead: unrelatedHead,
      },
    });
  });

  it('aborts a failed replay without leaving cherry-pick state', async () => {
    const expectedFeatureHead = await commitFile(repoPath, 'base.txt', 'feature', 'feature');
    const captured = await service.capture({
      featurePath: repoPath,
      baseCommit,
      expectedFeatureHead,
    });
    if (!captured.success) throw new Error('expected snapshot');
    const verificationPath = path.join(rootPath, 'replay-conflict');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'verify/replay-conflict',
      verificationPath,
      baseCommit,
    ]);
    fs.writeFileSync(path.join(verificationPath, 'base.txt'), 'local conflict');

    const replayed = await service.replay({ verificationPath, snapshot: captured.data });

    expect(replayed).toMatchObject({ success: false, error: { type: 'replay-conflict' } });
    expect(await git(verificationPath, ['rev-parse', 'HEAD'])).toBe(baseCommit);
    const cherryPickHead = await git(verificationPath, [
      'rev-parse',
      '--git-path',
      'CHERRY_PICK_HEAD',
    ]);
    expect(fs.existsSync(cherryPickHead)).toBe(false);
  });

  it('restores the exact pre-step state when cherry-pick applies before exec rejects', async () => {
    const expectedFeatureHead = await commitFile(repoPath, 'ambiguous.txt', 'feature', 'feature');
    const snapshot = {
      baseCommit,
      expectedFeatureHead,
      replayCommits: [expectedFeatureHead],
    };
    const verificationPath = path.join(rootPath, 'replay-applied-reject');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'verify/replay-applied-reject',
      verificationPath,
      baseCommit,
    ]);
    const delegate = new LocalExecutionContext({ root: repoPath });
    let rejectAfterApply = true;
    const ambiguousContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (rejectAfterApply && args.includes('cherry-pick') && args.includes('--ff')) {
          rejectAfterApply = false;
          await delegate.exec(command, args, options);
          throw new Error('transport rejected after cherry-pick applied');
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const replayed = await new FeatureSnapshotService(ambiguousContext).replay({
      verificationPath,
      snapshot,
    });

    expect(replayed).toMatchObject({ success: false, error: { type: 'replay-conflict' } });
    expect(await git(verificationPath, ['rev-parse', 'HEAD'])).toBe(baseCommit);
    expect(await git(verificationPath, ['status', '--porcelain'])).toBe('');
    expect(fs.existsSync(path.join(verificationPath, 'ambiguous.txt'))).toBe(false);
  });

  it('bounds recovery Git by one absolute deadline and starts nothing after expiry', async () => {
    const expectedFeatureHead = await commitFile(
      repoPath,
      'recovery-deadline.txt',
      'feature',
      'feature'
    );
    const verificationPath = path.join(rootPath, 'replay-recovery-deadline');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'verify/replay-recovery-deadline',
      verificationPath,
      baseCommit,
    ]);
    const delegate = new LocalExecutionContext({ root: repoPath });
    const recoveryTimeouts: number[] = [];
    let recoveryCalls = 0;
    let recovering = false;
    let nowSpy: ReturnType<typeof vi.spyOn> | undefined;
    const context: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (args.includes('cherry-pick') && args.includes('--ff')) {
          await delegate.exec(command, args, options);
          recovering = true;
          throw new Error('transport rejected after cherry-pick applied');
        }
        if (recovering) {
          recoveryCalls += 1;
          if (typeof options?.timeout === 'number') recoveryTimeouts.push(options.timeout);
          const firstRecoveryNow = Date.now();
          const result = await delegate.exec(command, args, options);
          if (recoveryCalls === 1) {
            nowSpy = vi.spyOn(Date, 'now').mockReturnValue(firstRecoveryNow + 30_001);
          }
          return result;
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    try {
      const replayed = await new FeatureSnapshotService(context).replay({
        verificationPath,
        snapshot: {
          baseCommit,
          expectedFeatureHead,
          replayCommits: [expectedFeatureHead],
        },
      });
      expect(replayed).toMatchObject({
        success: false,
        error: { type: 'replay-recovery-required' },
      });
    } finally {
      nowSpy?.mockRestore();
    }
    expect(recoveryCalls).toBe(1);
    expect(recoveryTimeouts).toHaveLength(1);
    expect(recoveryTimeouts[0]).toBeGreaterThan(0);
    expect(recoveryTimeouts[0]).toBeLessThanOrEqual(30_000);
  });

  it('returns cancellation only after an applied cherry-pick is rolled back exactly', async () => {
    const expectedFeatureHead = await commitFile(
      repoPath,
      'abort-ambiguous.txt',
      'feature',
      'feature'
    );
    const snapshot = {
      baseCommit,
      expectedFeatureHead,
      replayCommits: [expectedFeatureHead],
    };
    const verificationPath = path.join(rootPath, 'replay-applied-abort');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'verify/replay-applied-abort',
      verificationPath,
      baseCommit,
    ]);
    const controller = new AbortController();
    const delegate = new LocalExecutionContext({ root: repoPath });
    let abortAfterApply = true;
    const ambiguousContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (abortAfterApply && args.includes('cherry-pick') && args.includes('--ff')) {
          abortAfterApply = false;
          const applied = await delegate.exec(command, args, options);
          controller.abort();
          return applied;
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const replayed = await new FeatureSnapshotService(ambiguousContext).replay({
      verificationPath,
      snapshot,
      signal: controller.signal,
    });

    expect(replayed).toMatchObject({ success: false, error: { type: 'cancelled' } });
    expect(await git(verificationPath, ['rev-parse', 'HEAD'])).toBe(baseCommit);
    expect(await git(verificationPath, ['status', '--porcelain'])).toBe('');
    expect(fs.existsSync(path.join(verificationPath, 'abort-ambiguous.txt'))).toBe(false);
  });

  it('rolls back when cancellation lands during the post-apply head read', async () => {
    const expectedFeatureHead = await commitFile(
      repoPath,
      'abort-post-read.txt',
      'feature',
      'feature'
    );
    const verificationPath = path.join(rootPath, 'replay-abort-post-read');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'verify/replay-abort-post-read',
      verificationPath,
      baseCommit,
    ]);
    const controller = new AbortController();
    const delegate = new LocalExecutionContext({ root: repoPath });
    let applied = false;
    let stopPostRead = true;
    const context: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (args.includes('cherry-pick') && args.includes('--ff')) {
          const result = await delegate.exec(command, args, options);
          applied = true;
          return result;
        }
        if (applied && stopPostRead && args.at(-2) === 'rev-parse' && args.at(-1) === 'HEAD') {
          stopPostRead = false;
          controller.abort();
          throw new Error('transport stopped during post-apply head read');
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const replayed = await new FeatureSnapshotService(context).replay({
      verificationPath,
      snapshot: { baseCommit, expectedFeatureHead, replayCommits: [expectedFeatureHead] },
      signal: controller.signal,
    });

    expect(replayed).toMatchObject({ success: false, error: { type: 'cancelled' } });
    expect(await git(verificationPath, ['rev-parse', 'HEAD'])).toBe(baseCommit);
    expect(await git(verificationPath, ['status', '--porcelain'])).toBe('');
    expect(fs.existsSync(path.join(verificationPath, 'abort-post-read.txt'))).toBe(false);
  });

  it('returns deadline failure only after a successful cherry-pick is rolled back exactly', async () => {
    const expectedFeatureHead = await commitFile(
      repoPath,
      'deadline-replay.txt',
      'feature',
      'feature'
    );
    const verificationPath = path.join(rootPath, 'replay-success-deadline');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'verify/replay-success-deadline',
      verificationPath,
      baseCommit,
    ]);
    const deadlineAt = Date.now() + 60_000;
    const delegate = new LocalExecutionContext({ root: repoPath });
    let expireAfterApply = true;
    let nowSpy: ReturnType<typeof vi.spyOn> | undefined;
    const context: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        const result = await delegate.exec(command, args, options);
        if (expireAfterApply && args.includes('cherry-pick') && args.includes('--ff')) {
          expireAfterApply = false;
          nowSpy = vi.spyOn(Date, 'now').mockReturnValue(deadlineAt + 1);
        }
        return result;
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    try {
      const replayed = await new FeatureSnapshotService(context).replay({
        verificationPath,
        snapshot: { baseCommit, expectedFeatureHead, replayCommits: [expectedFeatureHead] },
        deadlineAt,
      });
      expect(replayed).toMatchObject({
        success: false,
        error: { type: 'deadline-exceeded' },
      });
    } finally {
      nowSpy?.mockRestore();
    }
    expect(await git(verificationPath, ['rev-parse', 'HEAD'])).toBe(baseCommit);
    expect(await git(verificationPath, ['status', '--porcelain'])).toBe('');
    expect(fs.existsSync(path.join(verificationPath, 'deadline-replay.txt'))).toBe(false);
  }, 30_000);

  it('refuses to claim replay success when the final remote HEAD is not the expected commit', async () => {
    let headReads = 0;
    const remoteContext: IExecutionContext = {
      root: '/remote/repo',
      supportsLocalSpawn: false,
      exec: async (_command, args = []) => {
        if (args.includes('rev-parse') && args.at(-1) === 'HEAD') {
          headReads += 1;
          return { stdout: `${baseCommit}\n`, stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
      execStreaming: async () => {},
      dispose: () => {},
    };

    const result = await new FeatureSnapshotService(remoteContext).replay({
      verificationPath: '/remote/worktrees/verification',
      snapshot: {
        baseCommit,
        expectedFeatureHead: 'a'.repeat(40),
        replayCommits: ['a'.repeat(40)],
      },
    });

    expect(headReads).toBe(2);
    expect(result).toEqual({
      success: false,
      error: {
        type: 'replay-head-mismatch',
        expected: 'a'.repeat(40),
        actual: baseCommit,
      },
    });
  });

  it('refuses fix integration after concurrent feature-head movement', async () => {
    const expectedFeatureHead = await commitFile(repoPath, 'feature.txt', 'feature', 'feature');
    const verificationPath = path.join(rootPath, 'fix');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'verify/fix',
      verificationPath,
      expectedFeatureHead,
    ]);
    const fixCommit = await commitFile(verificationPath, 'fix.txt', 'fix', 'fix');
    const movedHead = await commitFile(repoPath, 'concurrent.txt', 'move', 'concurrent');

    await expect(
      service.integrateFix({ featurePath: repoPath, expectedFeatureHead, fixCommit })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'feature-head-drift',
        expected: expectedFeatureHead,
        actual: movedHead,
      },
    });
  });

  it('integrates a verified fix with an optimistic head guard', async () => {
    const expectedFeatureHead = await commitFile(repoPath, 'feature.txt', 'feature', 'feature');
    const verificationPath = path.join(rootPath, 'fix-success');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'verify/fix-success',
      verificationPath,
      expectedFeatureHead,
    ]);
    const fixCommit = await commitFile(verificationPath, 'fix.txt', 'fix', 'fix');

    const integrated = await service.integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated.success).toBe(true);
    if (!integrated.success) throw new Error('expected integration');
    expect(integrated.data.featureHead).toMatch(/^[0-9a-f]{40}$/);
    expect(integrated.data.featureHead).not.toBe(expectedFeatureHead);
    expect(fs.readFileSync(path.join(repoPath, 'fix.txt'), 'utf8')).toBe('fix');
  });

  it('leaves an injected ancestor reset untouched when the expected-head ref CAS loses', async () => {
    const expectedFeatureHead = await commitFile(repoPath, 'feature.txt', 'feature', 'feature');
    const verificationPath = path.join(rootPath, 'fix-race');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'verify/fix-race',
      verificationPath,
      expectedFeatureHead,
    ]);
    const fixCommit = await commitFile(verificationPath, 'fix.txt', 'fix', 'fix');
    const delegate = new LocalExecutionContext({ root: repoPath });
    let injectMovement = true;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (injectMovement && args.includes('update-ref') && args.includes(`refs/heads/main`)) {
          injectMovement = false;
          await git(repoPath, ['reset', '--hard', baseCommit]);
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(racingContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-failed' },
    });
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(baseCommit);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
    expect(fs.existsSync(path.join(repoPath, 'feature.txt'))).toBe(false);
    expect(fs.existsSync(path.join(repoPath, 'fix.txt'))).toBe(false);
    const mergeHead = await git(repoPath, ['rev-parse', '--git-path', 'MERGE_HEAD']);
    expect(fs.existsSync(mergeHead)).toBe(false);
  });

  it('leaves an injected divergent reset untouched when the expected-head ref CAS loses', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-divergent-race');
    const divergentPath = path.join(rootPath, 'divergent-worktree');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'concurrent/divergent',
      divergentPath,
      baseCommit,
    ]);
    const divergentHead = await commitFile(
      divergentPath,
      'divergent.txt',
      'divergent',
      'divergent'
    );
    const delegate = new LocalExecutionContext({ root: repoPath });
    let injectMovement = true;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (injectMovement && args.includes('update-ref') && args.includes('refs/heads/main')) {
          injectMovement = false;
          await git(repoPath, ['reset', '--hard', divergentHead]);
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(racingContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-failed' },
    });
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(divergentHead);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
    expect(fs.readFileSync(path.join(repoPath, 'divergent.txt'), 'utf8')).toBe('divergent');
    expect(fs.existsSync(path.join(repoPath, 'fix-divergent-race-fix.txt'))).toBe(false);
  });

  it('rejects integration from a detached feature HEAD without changing files', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-detached');
    await git(repoPath, ['checkout', '--detach', expectedFeatureHead]);

    const integrated = await service.integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-failed' },
    });
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(expectedFeatureHead);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
    expect(fs.existsSync(path.join(repoPath, 'fix-detached-fix.txt'))).toBe(false);
  });

  it('restores the concurrently moved HEAD and bytes after movement immediately before sync', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-post-cas-race');
    const delegate = new LocalExecutionContext({ root: repoPath });
    let injectMovement = true;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (
          injectMovement &&
          args.includes('read-tree') &&
          args.at(-2) === expectedFeatureHead &&
          args.at(-1) === fixCommit
        ) {
          injectMovement = false;
          await git(repoPath, ['reset', '--hard', baseCommit]);
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(racingContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-failed' },
    });
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(baseCommit);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
    expect(fs.existsSync(path.join(repoPath, 'fix-post-cas-race-feature.txt'))).toBe(false);
    expect(fs.existsSync(path.join(repoPath, 'fix-post-cas-race-fix.txt'))).toBe(false);
  });

  it('restores a concurrently checked-out branch instead of applying fix bytes to it', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-branch-switch');
    const concurrentPath = path.join(rootPath, 'concurrent-branch-worktree');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'concurrent/branch-switch',
      concurrentPath,
      expectedFeatureHead,
    ]);
    const concurrentHead = await commitFile(
      concurrentPath,
      'concurrent-branch.txt',
      'concurrent branch',
      'concurrent branch'
    );
    await git(repoPath, ['worktree', 'remove', concurrentPath]);
    const delegate = new LocalExecutionContext({ root: repoPath });
    let switchBranch = true;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (
          switchBranch &&
          args.includes('read-tree') &&
          args.at(-2) === expectedFeatureHead &&
          args.at(-1) === fixCommit
        ) {
          switchBranch = false;
          await git(repoPath, ['checkout', 'concurrent/branch-switch']);
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(racingContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-failed' },
    });
    expect(await git(repoPath, ['symbolic-ref', '--short', 'HEAD'])).toBe(
      'concurrent/branch-switch'
    );
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(concurrentHead);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
    expect(fs.readFileSync(path.join(repoPath, 'concurrent-branch.txt'), 'utf8')).toBe(
      'concurrent branch'
    );
    expect(fs.existsSync(path.join(repoPath, 'fix-branch-switch-fix.txt'))).toBe(false);
  });

  it('converges to a second concurrent reset that lands immediately before restoration', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-two-reset-race');
    const concurrentPath = path.join(rootPath, 'two-reset-worktree');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'concurrent/two-reset',
      concurrentPath,
      expectedFeatureHead,
    ]);
    await git(concurrentPath, ['commit', '--allow-empty', '-m', 'concurrent one']);
    const concurrentOne = await git(concurrentPath, ['rev-parse', 'HEAD']);
    const concurrentTwo = await commitFile(
      concurrentPath,
      'concurrent-two.txt',
      'concurrent two',
      'concurrent two'
    );
    const delegate = new LocalExecutionContext({ root: repoPath });
    let resetBeforeForward = true;
    let resetBeforeRestore = true;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (
          resetBeforeForward &&
          args.includes('read-tree') &&
          args.at(-2) === expectedFeatureHead &&
          args.at(-1) === fixCommit
        ) {
          resetBeforeForward = false;
          await git(repoPath, ['reset', '--hard', concurrentOne]);
        } else if (
          resetBeforeRestore &&
          args.includes('read-tree') &&
          args.at(-2) === fixCommit &&
          args.at(-1) === concurrentOne
        ) {
          resetBeforeRestore = false;
          await git(repoPath, ['reset', '--hard', concurrentTwo]);
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(racingContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-failed' },
    });
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(concurrentTwo);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
    expect(fs.readFileSync(path.join(repoPath, 'concurrent-two.txt'), 'utf8')).toBe(
      'concurrent two'
    );
    expect(fs.existsSync(path.join(repoPath, 'fix-two-reset-race-fix.txt'))).toBe(false);
  });

  it('retries when HEAD moves after tree and index checks but before recovery attestation', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-stable-recovery');
    const concurrentPath = path.join(rootPath, 'stable-recovery-worktree');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'concurrent/stable-recovery',
      concurrentPath,
      expectedFeatureHead,
    ]);
    const concurrentOne = await commitFile(
      concurrentPath,
      'stable-one.txt',
      'stable one',
      'stable one'
    );
    const concurrentTwo = await commitFile(
      concurrentPath,
      'stable-two.txt',
      'stable two',
      'stable two'
    );
    const delegate = new LocalExecutionContext({ root: repoPath });
    let resetBeforeForward = true;
    let firstRecoverySyncCompleted = false;
    let moveAfterChecks = true;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (
          resetBeforeForward &&
          args.includes('read-tree') &&
          args.at(-2) === expectedFeatureHead &&
          args.at(-1) === fixCommit
        ) {
          resetBeforeForward = false;
          await git(repoPath, ['reset', '--hard', concurrentOne]);
        }
        const result = await delegate.exec(command, args, options);
        if (
          args.includes('read-tree') &&
          args.at(-2) === fixCommit &&
          args.at(-1) === concurrentOne
        ) {
          firstRecoverySyncCompleted = true;
        } else if (
          firstRecoverySyncCompleted &&
          moveAfterChecks &&
          args.includes('diff') &&
          args.includes('--cached') &&
          args.at(-1) === concurrentOne
        ) {
          moveAfterChecks = false;
          await git(repoPath, ['update-ref', 'refs/heads/main', concurrentTwo, concurrentOne]);
        }
        return result;
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(racingContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-failed' },
    });
    expect(moveAfterChecks).toBe(false);
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(concurrentTwo);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
    expect(fs.readFileSync(path.join(repoPath, 'stable-two.txt'), 'utf8')).toBe('stable two');
    expect(fs.existsSync(path.join(repoPath, 'fix-stable-recovery-fix.txt'))).toBe(false);
  });

  it('converges after five consecutive ref movements during bounded tree recovery', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-five-reset-race');
    const concurrentPath = path.join(rootPath, 'five-reset-worktree');
    await git(repoPath, [
      'worktree',
      'add',
      '-b',
      'concurrent/five-reset',
      concurrentPath,
      expectedFeatureHead,
    ]);
    await git(concurrentPath, ['commit', '--allow-empty', '-m', 'movement zero']);
    const movements = [await git(concurrentPath, ['rev-parse', 'HEAD'])];
    for (let index = 1; index <= 5; index += 1) {
      movements.push(
        await commitFile(concurrentPath, 'movement.txt', `movement ${index}`, `movement ${index}`)
      );
    }
    const delegate = new LocalExecutionContext({ root: repoPath });
    let resetBeforeForward = true;
    let restoreMovement = 0;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        const recoveryReadTree = args.includes('read-tree') && args.at(-2) !== expectedFeatureHead;
        if (
          resetBeforeForward &&
          args.includes('read-tree') &&
          args.at(-2) === expectedFeatureHead &&
          args.at(-1) === fixCommit
        ) {
          resetBeforeForward = false;
          await git(repoPath, ['reset', '--hard', movements[0]]);
        }
        const result = await delegate.exec(command, args, options);
        if (recoveryReadTree && restoreMovement < 5) {
          restoreMovement += 1;
          await git(repoPath, [
            'update-ref',
            'refs/heads/main',
            movements[restoreMovement],
            movements[restoreMovement - 1],
          ]);
        }
        return result;
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(racingContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-failed' },
    });
    expect(restoreMovement).toBe(5);
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(movements[5]);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
    expect(fs.readFileSync(path.join(repoPath, 'movement.txt'), 'utf8')).toBe('movement 5');
    expect(fs.existsSync(path.join(repoPath, 'fix-five-reset-race-fix.txt'))).toBe(false);
  }, 30_000);

  it('rolls the ref back when safe worktree synchronization refuses concurrent bytes', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-sync-refuses');
    const injectedPath = path.join(repoPath, 'fix-sync-refuses-fix.txt');
    const delegate = new LocalExecutionContext({ root: repoPath });
    let injectBytes = true;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (
          injectBytes &&
          args.includes('read-tree') &&
          args.at(-2) === expectedFeatureHead &&
          args.at(-1) === fixCommit
        ) {
          injectBytes = false;
          fs.writeFileSync(injectedPath, 'concurrent bytes');
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(racingContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-failed' },
    });
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(expectedFeatureHead);
    expect(fs.readFileSync(injectedPath, 'utf8')).toBe('concurrent bytes');
  });

  it('reports recovery-required when rollback CAS loses without overwriting the moved ref', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-rollback-cas-loss');
    const injectedPath = path.join(repoPath, 'fix-rollback-cas-loss-fix.txt');
    const delegate = new LocalExecutionContext({ root: repoPath });
    let injectBytes = true;
    let moveDuringRollback = true;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (
          injectBytes &&
          args.includes('read-tree') &&
          args.at(-2) === expectedFeatureHead &&
          args.at(-1) === fixCommit
        ) {
          injectBytes = false;
          fs.writeFileSync(injectedPath, 'preserve me');
        }
        if (
          moveDuringRollback &&
          args.includes('emdash: roll back Loop correction') &&
          args.includes('update-ref')
        ) {
          moveDuringRollback = false;
          await git(repoPath, ['update-ref', 'refs/heads/main', baseCommit, fixCommit]);
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(racingContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toEqual({
      success: false,
      error: {
        type: 'fix-integration-recovery-required',
        message: 'Feature integration state changed concurrently and requires explicit recovery.',
      },
    });
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(baseCommit);
    expect(fs.readFileSync(injectedPath, 'utf8')).toBe('preserve me');
  });

  it('reports recovery-required when reverse synchronization fails after rollback owns the ref', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-reverse-sync-fails');
    const delegate = new LocalExecutionContext({ root: repoPath });
    let failForwardSync = true;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (
          failForwardSync &&
          args.includes('read-tree') &&
          args.at(-2) === expectedFeatureHead &&
          args.at(-1) === fixCommit
        ) {
          failForwardSync = false;
          await delegate.exec(command, args, options);
          throw new Error('forward sync transport rejected after apply');
        }
        if (
          args.includes('read-tree') &&
          args.at(-2) === fixCommit &&
          args.at(-1) === expectedFeatureHead
        ) {
          throw new Error('reverse sync refused');
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(racingContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-recovery-required' },
    });
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(expectedFeatureHead);
    expect(fs.readFileSync(path.join(repoPath, 'fix-reverse-sync-fails-fix.txt'), 'utf8')).toBe(
      'fix'
    );
    expect(await git(repoPath, ['status', '--porcelain'])).toContain(
      'fix-reverse-sync-fails-fix.txt'
    );
  });

  it('rolls back an applied CAS when the update-ref transport rejects afterward', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-cas-rejects');
    const delegate = new LocalExecutionContext({ root: repoPath });
    let rejectAfterApply = true;
    const ambiguousContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (
          rejectAfterApply &&
          args.includes('emdash: integrate Loop correction') &&
          args.includes('update-ref')
        ) {
          rejectAfterApply = false;
          await delegate.exec(command, args, options);
          throw new Error('transport rejected after apply');
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(ambiguousContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
    });

    expect(integrated).toMatchObject({
      success: false,
      error: { type: 'fix-integration-failed' },
    });
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(expectedFeatureHead);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
  });

  it('preserves cancellation only after rolling back an applied CAS', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-cas-aborts');
    const controller = new AbortController();
    const delegate = new LocalExecutionContext({ root: repoPath });
    let abortAfterApply = true;
    const ambiguousContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (
          abortAfterApply &&
          args.includes('emdash: integrate Loop correction') &&
          args.includes('update-ref')
        ) {
          abortAfterApply = false;
          await delegate.exec(command, args, options);
          controller.abort();
          throw new Error('aborted after apply');
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    const integrated = await new FeatureSnapshotService(ambiguousContext).integrateFix({
      featurePath: repoPath,
      expectedFeatureHead,
      fixCommit,
      signal: controller.signal,
    });

    expect(integrated).toMatchObject({ success: false, error: { type: 'cancelled' } });
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(expectedFeatureHead);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
  });

  it('preserves deadline failure only after rolling back an applied CAS', async () => {
    const { expectedFeatureHead, fixCommit } = await prepareFix('fix-cas-times-out');
    const delegate = new LocalExecutionContext({ root: repoPath });
    const deadlineAt = Date.now() + 60_000;
    let rejectAfterApply = true;
    let nowSpy: ReturnType<typeof vi.spyOn> | undefined;
    const ambiguousContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (
          rejectAfterApply &&
          args.includes('emdash: integrate Loop correction') &&
          args.includes('update-ref')
        ) {
          rejectAfterApply = false;
          await delegate.exec(command, args, options);
          nowSpy = vi.spyOn(Date, 'now').mockReturnValue(deadlineAt + 1);
          throw new Error('timed out after apply');
        }
        return delegate.exec(command, args, options);
      },
      execStreaming: (command, args, onChunk, options) =>
        delegate.execStreaming(command, args, onChunk, options),
      dispose: () => delegate.dispose(),
    };

    try {
      const integrated = await new FeatureSnapshotService(ambiguousContext).integrateFix({
        featurePath: repoPath,
        expectedFeatureHead,
        fixCommit,
        deadlineAt,
      });
      expect(integrated).toMatchObject({
        success: false,
        error: { type: 'deadline-exceeded' },
      });
    } finally {
      nowSpy?.mockRestore();
    }
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(expectedFeatureHead);
    expect(await git(repoPath, ['status', '--porcelain'])).toBe('');
  }, 30_000);
});
