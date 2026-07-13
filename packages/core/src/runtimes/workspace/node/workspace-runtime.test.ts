import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok } from '@emdash/shared';
import type { Unsubscribe } from '@emdash/shared';
import type { LiveJobContext } from '@emdash/wire';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute, type HostFileRef } from '@primitives/path/api';
import { step } from '@runtimes/workspace/api';
import type {
  WorkspaceActivityResource,
  WorkspaceOperationProgress,
} from '@runtimes/workspace/api';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceActivityProvider } from './activity';
import type { WorkspaceScriptEngine } from './scripts';
import { WorkspaceRuntime } from './workspace-runtime';

describe('WorkspaceRuntime', () => {
  it('publishes observed topology and activated consumers', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspace = hostFileRefFromNative(root);
      const runtime = new WorkspaceRuntime();
      const progress: WorkspaceOperationProgress[] = [];

      const result = await runtime.activate(
        { workspace, consumerId: 'task-1' },
        jobContext('activate-1', progress)
      );

      expect(result.success).toBe(true);
      expect(progress.some((entry) => entry.kind === 'activate')).toBe(true);
      const state = runtime.host.get(workspace)?.states.state.snapshot().data;
      expect(state?.topology.kind).toBe('directory');
      expect(state?.consumers).toEqual([{ id: 'task-1', activatedAt: expect.any(Number) }]);

      runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks teardown while a consumer is active', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspace = hostFileRefFromNative(root);
      const runtime = new WorkspaceRuntime();

      await runtime.activate({ workspace, consumerId: 'task-1' }, jobContext('activate-1'));
      const result = await runtime.teardown({ workspace, force: false }, jobContext('teardown-1'));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('workspace-busy');
      }

      runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not run automation scripts during activation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspace = hostFileRefFromNative(root);
      const scripts: WorkspaceScriptEngine = {
        run: vi.fn().mockResolvedValue(ok(undefined)),
        stopWorkspace: vi.fn().mockResolvedValue(ok(undefined)),
      };
      const runtime = new WorkspaceRuntime({ scripts });
      const automation = {
        setup: 'echo setup',
        autoRunSetup: true,
        autoRunRun: false,
      };

      const activation = await runtime.activate(
        { workspace, consumerId: 'task-1', automation },
        jobContext('activate-1')
      );
      expect(activation.success).toBe(true);
      expect(scripts.run).not.toHaveBeenCalled();

      const script = await runtime.runScript(
        { workspace, consumerId: 'task-1', script: 'setup', automation },
        jobContext('script-1')
      );
      expect(script.success).toBe(true);
      expect(scripts.run).toHaveBeenCalledOnce();

      runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('blocks teardown on activity resources unless force is set', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspace = hostFileRefFromNative(root);
      let publish:
        | ((workspace: HostFileRef, resources: WorkspaceActivityResource[]) => void)
        | undefined;
      const activityProvider: WorkspaceActivityProvider = {
        attach(onActivity) {
          publish = onActivity;
          return (() => {}) satisfies Unsubscribe;
        },
      };
      const runtime = new WorkspaceRuntime({ activityProviders: [activityProvider] });
      publish?.(workspace, [
        {
          runtime: 'acp',
          resourceId: 'session-1',
          status: 'running',
        },
      ]);

      const blocked = await runtime.teardown(
        { workspace, force: false },
        jobContext('teardown-blocked')
      );
      expect(blocked.success).toBe(false);
      if (!blocked.success) {
        expect(blocked.error).toMatchObject({
          type: 'workspace-busy',
          holders: ['acp:session-1'],
        });
      }

      const forced = await runtime.teardown(
        { workspace, force: true },
        jobContext('teardown-forced')
      );
      expect(forced.success).toBe(true);

      runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('runs non-empty provision plans and publishes lifecycle progress', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspacePath = path.join(root, 'workspace');
      const workspace = hostFileRefFromNative(workspacePath);
      const runtime = new WorkspaceRuntime();
      const progress: WorkspaceOperationProgress[] = [];

      const result = await runtime.provision(
        {
          workspace,
          lifecycle: {
            ref: { kind: 'directory', path: workspacePath },
            context: { repoPath: root, preservePatterns: [] },
            setupPlan: {
              steps: [
                {
                  id: 'create-directory:1',
                  label: 'Create directory',
                  step: step('create-directory', { path: workspacePath }),
                },
              ],
            },
          },
        },
        jobContext('provision-1', progress)
      );

      expect(result.success).toBe(true);
      const lifecycleStage = progress
        .flatMap((entry) => entry.stages)
        .filter((stageEntry) => stageEntry.id === 'lifecycle')
        .at(-1);
      expect(lifecycleStage?.status).toBe('done');
      const state = runtime.host.get(workspace)?.states.state.snapshot().data;
      expect(state?.topology.kind).toBe('directory');

      runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function jobContext(
  jobId: string,
  progress: WorkspaceOperationProgress[] = []
): LiveJobContext<WorkspaceOperationProgress> {
  return {
    jobId,
    signal: new AbortController().signal,
    progress: (entry) => progress.push(entry),
  };
}

function hostFileRefFromNative(nativePath: string): HostFileRef {
  const parsed = parseAbsolute(nativePath, {
    profile: {
      style: process.platform === 'win32' ? 'win32' : 'posix',
      unicodeNormalization: 'preserve',
    },
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return hostFileRef(LOCAL_HOST_REF, parsed.data);
}
