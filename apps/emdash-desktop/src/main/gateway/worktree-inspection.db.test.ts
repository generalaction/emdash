import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { gitContract } from '@emdash/core/runtimes/git/api';
import { createGitProcedures, GitRuntime } from '@emdash/core/runtimes/git/node';
import { ok } from '@emdash/shared';
import { createInProcessWire } from '@emdash/wire/rpc';
import { openFixture } from '@tooling/utils/db';
import { expect, it } from 'vitest';
import { createSourceControlWireController } from '@core/features/source-control/node/wire-controller';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { createWorkspaceIdentityService } from '@core/features/workspaces/node/workspace-identity-source';
import { projects } from '@core/services/app-db/node/schema';

const runGit = promisify(execFile);

it('reads the index and changes of an externally created worktree without a task link', async () => {
  const fixture = await openFixture('empty');
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'emdash-inspect-worktree-')));
  const repository = join(directory, 'repo');
  const worktree = join(directory, 'subagent');
  const git = (args: string[], cwd = repository) => runGit('git', args, { cwd, timeout: 10_000 });
  const runtime = new GitRuntime({
    watcher: {
      watch: () => ({ ready: async () => ok(undefined), release: async () => {} }),
      dispose: async () => {},
    },
  });
  const wire = createInProcessWire(gitContract, createGitProcedures(runtime), { validate: 'full' });
  const identity = createWorkspaceIdentityService({ db: fixture.db });
  const controller = createSourceControlWireController({
    workspaceIdentity: identity,
    runtimes: { client: async () => ok({ git: wire.client }) } as never,
    projects: {
      requireAttached: () => {
        throw new Error('Checkout reads must not require a task');
      },
    },
    mintOperationCredentials: async () => undefined,
  });

  try {
    await runGit('git', ['init', '-b', 'main', repository], { timeout: 10_000 });
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(join(repository, 'file.txt'), 'initial\n');
    await git(['add', '.']);
    await git(['commit', '-m', 'initial']);
    await git(['worktree', 'add', '-b', 'subagent', worktree]);
    await writeFile(join(worktree, 'file.txt'), 'subagent base\n');
    await git(['commit', '-am', 'subagent base'], worktree);
    await writeFile(join(worktree, 'file.txt'), 'subagent staged\n');
    await git(['add', '.'], worktree);
    await writeFile(join(worktree, 'file.txt'), 'subagent disk\n');

    const registry = createWorkspaceRegistry(fixture.db);
    registry.recordCreationIntent({
      id: 'repo',
      kind: 'repository',
      type: 'local',
      location: 'local',
      path: repository,
    });
    fixture.db
      .insert(projects)
      .values({
        id: 'project',
        name: 'Project',
        repositoryWorkspaceId: 'repo',
      })
      .run();
    registry.recordCreationIntent({
      id: 'subagent',
      kind: 'worktree',
      origin: 'adopted',
      parentId: 'repo',
      type: 'local',
      location: 'local',
      path: worktree,
    });

    expect(await identity.resolve('subagent')).toEqual({
      projectId: 'project',
      workspaceId: 'subagent',
      host: LOCAL_HOST_REF,
      path: worktree,
    });
    expect(
      await controller.call('checkout.getFile', {
        workspaceId: 'subagent',
        path: 'file.txt',
        source: { kind: 'head' },
      })
    ).toEqual(ok({ content: 'subagent base\n' }));
    expect(
      await controller.call('checkout.getFile', {
        workspaceId: 'subagent',
        path: 'file.txt',
        source: { kind: 'index' },
      })
    ).toEqual(ok({ content: 'subagent staged\n' }));
    expect(
      await controller.call('checkout.getFile', {
        workspaceId: 'repo',
        path: 'file.txt',
        source: { kind: 'head' },
      })
    ).toEqual(ok({ content: 'initial\n' }));
    const changes = await controller.call('checkout.getChangedFiles', {
      workspaceId: 'subagent',
      target: { kind: 'working-vs-index' },
    });
    expect(changes).toMatchObject({
      success: true,
      data: { files: [expect.objectContaining({ path: 'file.txt', status: 'modified' })] },
    });
  } finally {
    await controller.dispose?.();
    await wire.dispose();
    await runtime.dispose();
    fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
