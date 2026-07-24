import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { err, ok, type Unsubscribe } from '@emdash/shared';
import type { LiveJobContext } from '@emdash/wire';
import { createTestWire } from '@emdash/wire/testing';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute, type HostFileRef } from '@primitives/path/api';
import { step } from '@runtimes/workspace/api';
import type {
  WorkspaceActivityResource,
  WorkspaceOperationProgress,
} from '@runtimes/workspace/api';
import {
  scriptWorkflowsContract,
  type RunScriptWorkflowInput,
  type TerminalError,
} from '@services/script-workflows/api';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceActivityProvider } from './activity';
import { WorkspaceRuntime } from './workspace-runtime';

const execFileAsync = promisify(execFile);

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

  it('runs prepare before activation completes and starts setup/run after prepared', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    const calls: RunScriptWorkflowInput[] = [];
    const wire = scriptWorkflowWire(calls);
    try {
      const workspace = hostFileRefFromNative(root);
      const runtime = new WorkspaceRuntime({ terminals: wire.client });
      const automation = {
        prepare: 'python -m venv .venv',
        setup: 'echo setup',
        run: 'pnpm dev',
        shellSetup: 'source .venv/bin/activate',
        env: { EMDASH_TASK_ID: 'task-1' },
        autoRunSetup: true,
        autoRunRun: true,
      };

      const activation = await runtime.activate(
        { workspace, consumerId: 'task-1', automation },
        jobContext('activate-1')
      );
      expect(activation.success).toBe(true);
      expect(calls[0]).toMatchObject({
        kind: 'prepare',
        nodes: [
          {
            id: 'prepare',
            command: 'python -m venv .venv',
            shellSetup: 'source .venv/bin/activate',
            env: expect.objectContaining({ EMDASH_TASK_ID: 'task-1' }),
          },
        ],
      });
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      expect(calls[1]).toMatchObject({
        kind: 'post-activation',
        nodes: [
          { id: 'setup', command: 'echo setup' },
          { id: 'run', command: 'pnpm dev', dependsOn: ['setup'], lifecycle: 'background' },
        ],
      });
      const state = runtime.host.get(workspace)?.states.state.snapshot().data;
      expect(state?.prepared).toBe(true);

      runtime.dispose();
    } finally {
      await wire.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails activation when prepare fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    const calls: RunScriptWorkflowInput[] = [];
    const wire = scriptWorkflowWire(calls, { failPrepare: true });
    try {
      const workspace = hostFileRefFromNative(root);
      const runtime = new WorkspaceRuntime({ terminals: wire.client });

      const activation = await runtime.activate(
        {
          workspace,
          consumerId: 'task-1',
          automation: { prepare: 'exit 1', autoRunSetup: true, autoRunRun: false },
        },
        jobContext('activate-prepare-failed')
      );

      expect(activation.success).toBe(false);
      expect(calls).toHaveLength(1);
      const state = runtime.host.get(workspace)?.states.state.snapshot().data;
      expect(state?.prepared).toBe(false);
      expect(state?.consumers).toEqual([]);

      runtime.dispose();
    } finally {
      await wire.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips prepare and setup/run for additional consumers of a prepared workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    const calls: RunScriptWorkflowInput[] = [];
    const wire = scriptWorkflowWire(calls);
    try {
      const workspace = hostFileRefFromNative(root);
      const runtime = new WorkspaceRuntime({ terminals: wire.client });
      const automation = {
        prepare: 'echo prepare',
        setup: 'echo setup',
        autoRunSetup: true,
        autoRunRun: false,
      };

      const first = await runtime.activate(
        { workspace, consumerId: 'task-1', automation },
        jobContext('activate-1')
      );
      expect(first.success).toBe(true);
      await vi.waitFor(() => expect(calls).toHaveLength(2));

      const second = await runtime.activate(
        { workspace, consumerId: 'task-2', automation },
        jobContext('activate-2')
      );
      expect(second.success).toBe(true);
      expect(calls).toHaveLength(2);

      await runtime.deactivate(
        { workspace, consumerId: 'task-1', strategy: 'detach', automation },
        jobContext('deactivate-1')
      );
      expect(runtime.host.get(workspace)?.states.state.snapshot().data.prepared).toBe(true);
      await runtime.deactivate(
        { workspace, consumerId: 'task-2', strategy: 'detach', automation },
        jobContext('deactivate-2')
      );
      expect(runtime.host.get(workspace)?.states.state.snapshot().data.prepared).toBe(false);

      runtime.dispose();
    } finally {
      await wire.dispose();
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

  it('measures total and gitignored artifact usage', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      await initIgnoredArtifactRepo(root);
      const workspace = hostFileRefFromNative(root);
      const runtime = new WorkspaceRuntime();

      const result = await runtime.measureUsage({ workspace, repoPath: workspace });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalBytes).toBeGreaterThan(0);
        expect(result.data.artifactBytes).toBeGreaterThan(0);
        expect(result.data.totalBytes).toBeGreaterThanOrEqual(result.data.artifactBytes);
      }

      runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleans gitignored artifacts while preserving configured files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      await initIgnoredArtifactRepo(root);
      const workspace = hostFileRefFromNative(root);
      const runtime = new WorkspaceRuntime();

      const result = await runtime.cleanArtifacts(
        { workspace, repoPath: workspace, preservePatterns: ['.env*'] },
        jobContext('clean-artifacts-1')
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reclaimedBytes).toBeGreaterThan(0);
      }
      await expect(access(path.join(root, 'node_modules', 'pkg', 'index.js'))).rejects.toThrow();
      await expect(access(path.join(root, 'dist', 'bundle.js'))).rejects.toThrow();
      await expect(access(path.join(root, '.env.local'))).resolves.toBeUndefined();

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

function scriptWorkflowWire(
  calls: RunScriptWorkflowInput[],
  options: { failPrepare?: boolean } = {}
) {
  return createTestWire(scriptWorkflowsContract, {
    runWorkflow: {
      run: async (input) => {
        calls.push(input);
        if (options.failPrepare && input.kind === 'prepare') {
          return err<TerminalError>({
            type: 'script-failed',
            message: 'Prepare failed',
            nodeId: 'prepare',
          });
        }
        return ok({
          workflowId: `${input.kind}-${calls.length}`,
          kind: input.kind,
          completedNodes: input.nodes.map((node) => node.id),
        });
      },
    },
    killScope: async () => ok(undefined),
    detachScope: async () => ok(undefined),
  });
}

async function initIgnoredArtifactRepo(root: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: root });
  await writeFile(path.join(root, '.gitignore'), 'node_modules/\ndist/\n.env*\n', 'utf8');
  await writeFile(path.join(root, 'tracked.txt'), 'source', 'utf8');
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'ignored', 'utf8');
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'bundle.js'), 'ignored', 'utf8');
  await writeFile(path.join(root, '.env.local'), 'secret', 'utf8');
}
