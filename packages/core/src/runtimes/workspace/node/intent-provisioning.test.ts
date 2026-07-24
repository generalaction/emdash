import { ok } from '@emdash/shared';
import type { LiveJobContext } from '@emdash/wire';
import { hostRef } from '@primitives/host/api';
import { hostFileRef, parseAbsolute } from '@primitives/path/api';
import type { WorkspaceProvisioningProgress } from '@services/workspace-provisioning/api';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceRuntime } from './workspace-runtime';

const host = hostRef('remote', 'remote-1');
const repository = absolute('/srv/repository');

describe('WorkspaceRuntime.provisionFromIntent', () => {
  it('compiles a worktree intent and delegates to low-level provisioning', async () => {
    const runtime = new WorkspaceRuntime();
    const provision = vi.spyOn(runtime, 'provision').mockImplementation(async (input) =>
      ok({
        workspace: input.workspace,
        path: '/srv/worktrees/automation-1',
      })
    );

    try {
      const result = await runtime.provisionFromIntent(
        {
          workspace: {
            kind: 'worktree',
            repository,
            worktreePoolPath: absolutePath('/srv/worktrees'),
            baseRemote: 'upstream',
            preservePatterns: ['.env*'],
            git: {
              kind: 'create-branch',
              fromBranch: { type: 'local', branch: 'main' },
              pushRemote: 'fork',
            },
          },
          generatedName: 'automation-1',
        },
        jobContext()
      );

      expect(result).toEqual(
        ok({ workspace: absolute('/srv/worktrees/automation-1'), branchName: 'automation-1' })
      );
      expect(provision).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: absolute('/srv/worktrees/automation-1'),
          lifecycle: expect.objectContaining({
            ref: {
              kind: 'worktree',
              repoPath: '/srv/repository',
              path: '/srv/worktrees/automation-1',
              branchName: 'automation-1',
            },
            context: {
              repoPath: '/srv/repository',
              preservePatterns: ['.env*'],
              worktreePoolPath: '/srv/worktrees',
            },
            setupPlan: expect.objectContaining({
              steps: expect.arrayContaining([
                expect.objectContaining({
                  step: {
                    kind: 'push-branch',
                    args: {
                      branchName: 'automation-1',
                      remote: 'fork',
                      setUpstream: true,
                    },
                  },
                }),
              ]),
            }),
          }),
        }),
        expect.objectContaining({ jobId: 'job-1' })
      );
    } finally {
      runtime.dispose();
    }
  });

  it('provisions fixed directories without worktree placement inputs', async () => {
    const runtime = new WorkspaceRuntime();
    const provision = vi.spyOn(runtime, 'provision').mockImplementation(async (input) =>
      ok({
        workspace: input.workspace,
        path: '/srv/fixed',
      })
    );

    try {
      const directory = absolute('/srv/fixed');
      await expect(
        runtime.provisionFromIntent(
          { workspace: { kind: 'directory', path: directory }, generatedName: 'automation-3' },
          jobContext()
        )
      ).resolves.toEqual(ok({ workspace: directory, branchName: null }));
      expect(provision).toHaveBeenCalledWith({ workspace: directory }, expect.any(Object));
    } finally {
      runtime.dispose();
    }
  });
});

function jobContext(): LiveJobContext<WorkspaceProvisioningProgress> {
  return {
    jobId: 'job-1',
    signal: new AbortController().signal,
    progress: vi.fn(),
  };
}

function absolutePath(input: string) {
  return absolute(input).path;
}

function absolute(input: string) {
  const parsed = parseAbsolute(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(host, parsed.data);
}
