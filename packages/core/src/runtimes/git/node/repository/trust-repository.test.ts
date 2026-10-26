import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ok } from '@emdash/shared';
import { client, connect, memoryTransportPair, serve } from '@emdash/wire/rpc';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { safeDirectoryCommand } from '#primitives/git/api';
import { gitContract } from '#runtimes/git/api';
import { createGitController } from '#runtimes/git/node/api/controller';
import { GitRuntime } from '#runtimes/git/node/git-runtime';
import { hostPath } from '#runtimes/git/node/testing/paths';
import type { IWatchService } from '#services/fs-watch/api';

const execFileAsync = promisify(execFile);

const noopWatcher: IWatchService = {
  watch: () => ({ ready: async () => ok(undefined), release: async () => {} }),
  dispose: async () => {},
};

/**
 * Real Git with an isolated global config: `GIT_TEST_ASSUME_DIFFERENT_OWNER` makes Git treat
 * every repository as owned by someone else, exactly as for a WSL share or network drive, and
 * the environment never includes the developer's own HOME or global config.
 */
describe('trusting a repository Git refuses for its ownership', () => {
  let root: string;
  let globalConfig: string;
  let repository: string;
  const cleanups: Array<() => Promise<void> | void> = [];

  function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH,
      HOME: path.join(root, 'home'),
      XDG_CONFIG_HOME: path.join(root, 'home', '.config'),
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      LC_ALL: 'C',
      ...extra,
    };
  }

  async function git(args: string[], extra: NodeJS.ProcessEnv = {}): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: root, env: gitEnv(extra) });
    return stdout;
  }

  async function globalSafeDirectories(): Promise<string[]> {
    try {
      return (await git(['config', '--global', '--null', '--get-all', 'safe.directory']))
        .split('\0')
        .slice(0, -1);
    } catch {
      return [];
    }
  }

  async function makeRepository(name: string): Promise<string> {
    const directory = path.join(root, name);
    await git(['init', '--quiet', directory]);
    return await realpath(directory);
  }

  function connectRuntime(extra: NodeJS.ProcessEnv = {}) {
    const runtime = new GitRuntime({
      watcher: noopWatcher,
      env: async () => gitEnv({ GIT_TEST_ASSUME_DIFFERENT_OWNER: '1', ...extra }),
    });
    const controller = createGitController(runtime);
    const pair = memoryTransportPair();
    const stop = serve(pair.right, controller);
    cleanups.push(async () => {
      stop();
      controller.dispose?.();
      await runtime.dispose();
    });
    return client(gitContract, connect(pair.left));
  }

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-trust-repository-')));
    globalConfig = path.join(root, 'gitconfig');
    await mkdir(path.join(root, 'home'));
    repository = await makeRepository('my repo');
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    await rm(root, { recursive: true, force: true });
  });

  it("reports the repository and Git's own safe.directory suggestion", async () => {
    const git = connectRuntime();
    const subdirectory = path.join(repository, 'nested');
    await mkdir(subdirectory);

    const inspected = await git.inspectPath({ path: hostPath(subdirectory) });

    expect(inspected).toMatchObject({
      success: false,
      error: {
        type: 'inspect-failed',
        message: expect.stringContaining('detected dubious ownership'),
        dubiousOwnership: { repositoryPath: repository, safeDirectory: repository },
      },
    });
    if (inspected.success) return;
    expect(inspected.error.message).toContain(safeDirectoryCommand(repository));
  });

  it('adds exactly one entry for that repository, then Git opens it', async () => {
    const git = connectRuntime();
    const sibling = await makeRepository('sibling');
    const subdirectory = path.join(repository, 'nested');
    await mkdir(subdirectory);

    await expect(
      git.trustRepository({ path: hostPath(subdirectory), safeDirectory: repository })
    ).resolves.toEqual({ success: true, data: { added: true } });
    await expect(
      git.trustRepository({ path: hostPath(repository), safeDirectory: repository })
    ).resolves.toEqual({ success: true, data: { added: false } });

    expect(await globalSafeDirectories()).toEqual([repository]);
    await expect(git.inspectPath({ path: hostPath(repository) })).resolves.toMatchObject({
      success: true,
      data: { kind: 'repository', rootPath: hostPath(repository) },
    });
    await expect(git.inspectPath({ path: hostPath(sibling) })).resolves.toMatchObject({
      success: false,
      error: { dubiousOwnership: { safeDirectory: sibling } },
    });
  });

  it.each([
    '*',
    '',
    '.',
    'my repo',
    '~/my repo',
    '%(prefix)/my repo',
    '<repository>/*',
    '<repository>/../sibling',
    '<repository>\n',
  ])('rejects %j without touching the global config', async (value) => {
    const git = connectRuntime();
    const safeDirectory = value.replace('<repository>', repository);

    await expect(
      git.trustRepository({ path: hostPath(repository), safeDirectory })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'trust-failed', reason: 'invalid-value' },
    });
    await expect(access(globalConfig)).rejects.toThrow();
  });

  it('refuses a value other than the one Git suggests for the path', async () => {
    const git = connectRuntime();
    const sibling = await makeRepository('sibling');

    await expect(
      git.trustRepository({ path: hostPath(repository), safeDirectory: sibling })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'trust-failed', reason: 'repository-changed' },
    });
    await expect(access(globalConfig)).rejects.toThrow();
  });

  it('writes nothing for a directory Git does not refuse', async () => {
    const git = connectRuntime();
    const directory = path.join(root, 'plain');
    await mkdir(directory);

    await expect(
      git.trustRepository({ path: hostPath(directory), safeDirectory: directory })
    ).resolves.toEqual({ success: true, data: { added: false } });
    await expect(access(globalConfig)).rejects.toThrow();
  });

  describe('when a later protected config entry resets the list', () => {
    // Command-line config is read after the global file, so an empty value there undoes any
    // entry this operation can write.
    const reset = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '',
    };

    it('removes the entry it added again', async () => {
      const git = connectRuntime(reset);

      await expect(
        git.trustRepository({ path: hostPath(repository), safeDirectory: repository })
      ).resolves.toMatchObject({
        success: false,
        error: {
          type: 'trust-failed',
          reason: 'still-refused',
          message: expect.stringContaining('removed again'),
        },
      });
      expect(await globalSafeDirectories()).toEqual([]);
    });

    it('does not add a duplicate of an existing entry', async () => {
      const git = connectRuntime(reset);
      await execFileAsync('git', ['config', '--global', '--add', 'safe.directory', repository], {
        env: gitEnv(),
      });

      await expect(
        git.trustRepository({ path: hostPath(repository), safeDirectory: repository })
      ).resolves.toMatchObject({
        success: false,
        error: { type: 'trust-failed', reason: 'still-refused' },
      });
      expect(await globalSafeDirectories()).toEqual([repository]);
    });
  });

  it('reports a global config Git cannot write', async () => {
    await mkdir(globalConfig);
    const git = connectRuntime();

    await expect(
      git.trustRepository({ path: hostPath(repository), safeDirectory: repository })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'trust-failed', reason: 'config-failed' },
    });
  });
});
