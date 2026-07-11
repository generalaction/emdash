import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('fails atomically when the feature head moves after validation but before integration', async () => {
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
    let movedHead = '';
    let injectMovement = true;
    const racingContext: IExecutionContext = {
      root: repoPath,
      supportsLocalSpawn: true,
      exec: async (command, args = [], options) => {
        if (injectMovement && args.includes('merge') && args.includes('--ff-only')) {
          injectMovement = false;
          movedHead = await commitFile(repoPath, 'concurrent.txt', 'concurrent', 'concurrent');
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
    expect(await git(repoPath, ['rev-parse', 'HEAD'])).toBe(movedHead);
    expect(fs.existsSync(path.join(repoPath, 'fix.txt'))).toBe(false);
    const mergeHead = await git(repoPath, ['rev-parse', '--git-path', 'MERGE_HEAD']);
    expect(fs.existsSync(mergeHead)).toBe(false);
  });
});
