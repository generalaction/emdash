import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { err, ok, type Unsubscribe } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import type { LiveJobContext } from '@emdash/wire';
import { createTestWire } from '@emdash/wire/testing';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute, type HostFileRef } from '@primitives/path/api';
import { step } from '@runtimes/workspace/api';
import type {
  WorkspaceActivityResource,
  WorkspaceOperationProgress,
} from '@runtimes/workspace/api';
import { createMemoryWorkspaceOperationRecordStore } from '@runtimes/workspace/api/operation-records';
import {
  scriptWorkflowsContract,
  type RunScriptWorkflowInput,
  type TerminalError,
} from '@services/script-workflows/api';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceActivityProvider } from './activity';
import type { WorkspaceProvisioner } from './provisioning/provisioner';
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

  it('preempts an in-flight activation before teardown', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspace = hostFileRefFromNative(root);
      const activationInspectStarted = deferred<void>();
      let inspectCount = 0;
      const provisioner: WorkspaceProvisioner = {
        async inspect(_workspace, options) {
          inspectCount += 1;
          if (inspectCount === 2) {
            activationInspectStarted.resolve();
            return await new Promise((resolve) => {
              options?.signal?.addEventListener(
                'abort',
                () =>
                  resolve(
                    err({
                      type: 'cancelled',
                      message: 'Activation inspect was cancelled',
                    })
                  ),
                { once: true }
              );
            });
          }
          return ok({ kind: 'directory' });
        },
        async provision() {
          return ok({ kind: 'directory' });
        },
        async convert() {
          return ok({ kind: 'directory' });
        },
        async remove() {
          return ok(undefined);
        },
      };
      const runtime = new WorkspaceRuntime({ provisioner });

      const activation = runtime.activate(
        { workspace, consumerId: 'task-1' },
        jobContext('activate-1')
      );
      await activationInspectStarted.promise;

      const teardown = await runtime.teardown({ workspace, force: true }, jobContext('teardown-1'));
      const activationResult = await activation;

      expect(teardown.success).toBe(true);
      expect(activationResult.success).toBe(false);
      if (!activationResult.success) {
        expect(activationResult.error.type).toBe('cancelled');
      }
      expect(runtime.host.get(workspace)?.states.state.snapshot().data.operation.kind).toBe('idle');

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
      expect(state?.sessionPrepared).toBe(true);

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
      expect(state?.sessionPrepared).toBe(false);
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
      expect(runtime.host.get(workspace)?.states.state.snapshot().data.sessionPrepared).toBe(true);
      await runtime.deactivate(
        { workspace, consumerId: 'task-2', strategy: 'detach', automation },
        jobContext('deactivate-2')
      );
      expect(runtime.host.get(workspace)?.states.state.snapshot().data.sessionPrepared).toBe(false);

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

  it('persists operation records through start, progress, and terminal success', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspace = hostFileRefFromNative(root);
      const operationRecords = createMemoryWorkspaceOperationRecordStore({ now: () => 100 });
      const runtime = new WorkspaceRuntime({ operationRecords, now: () => 100 });

      const result = await runtime.activate(
        { workspace, consumerId: 'task-1' },
        jobContext('activate-record-1')
      );

      expect(result.success).toBe(true);
      const record = operationRecords.snapshot().records['activate-record-1'];
      expect(record).toMatchObject({
        requestId: 'activate-record-1',
        kind: 'activate',
        status: 'succeeded',
        result: { kind: 'activate' },
        finishedAt: 100,
      });
      expect(record.stages?.kind).toBe('activate');
      expect(record.stages?.stages.some((stage) => stage.id === 'inspect')).toBe(true);

      runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('suspends non-resumable records on runtime boot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspace = hostFileRefFromNative(root);
      const operationRecords = createMemoryWorkspaceOperationRecordStore({ now: () => 200 });
      await operationRecords.appendRecord({
        requestId: 'provision-record-1',
        kind: 'provision',
        workspace,
        params: { kind: 'provision', input: { workspace } },
        status: 'running',
      });

      const runtime = new WorkspaceRuntime({ operationRecords, now: () => 200 });
      await vi.waitFor(() =>
        expect(operationRecords.snapshot().records['provision-record-1']).toMatchObject({
          status: 'suspended',
          suspendedCause: 'daemon-restart',
          finishedAt: 200,
        })
      );

      runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resumes resumable records on runtime boot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspace = hostFileRefFromNative(root);
      const operationRecords = createMemoryWorkspaceOperationRecordStore({ now: () => 300 });
      await operationRecords.appendRecord({
        requestId: 'teardown-record-1',
        kind: 'teardown',
        workspace,
        params: { kind: 'teardown', input: { workspace, force: true } },
        status: 'running',
      });

      const runtime = new WorkspaceRuntime({ operationRecords, now: () => 300 });
      await vi.waitFor(() =>
        expect(operationRecords.snapshot().records['teardown-record-1']).toMatchObject({
          status: 'succeeded',
          result: { kind: 'teardown' },
          finishedAt: 300,
        })
      );

      runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('deduplicates non-terminal records and replaces terminal failures on submit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspace = hostFileRefFromNative(root);
      const operationRecords = createMemoryWorkspaceOperationRecordStore({ now: () => 400 });
      const runtime = new WorkspaceRuntime({ operationRecords, now: () => 400 });

      await operationRecords.appendRecord({
        requestId: 'teardown-request-1',
        kind: 'teardown',
        workspace,
        params: { kind: 'teardown', input: { workspace, force: false } },
        status: 'pending',
      });

      await expect(
        runtime.submitOperation({
          requestId: 'teardown-request-1',
          kind: 'teardown',
          workspace,
          params: { kind: 'teardown', input: { workspace, force: false } },
        })
      ).resolves.toEqual({
        success: true,
        data: { requestId: 'teardown-request-1', seq: 1, outcome: 'duplicate' },
      });

      await operationRecords.updateRecord('teardown-request-1', {
        status: 'failed',
        error: { type: 'failed', message: 'Failed' },
        finishedAt: 400,
      });
      await expect(
        runtime.submitOperation({
          requestId: 'teardown-request-1',
          kind: 'teardown',
          workspace,
          params: { kind: 'teardown', input: { workspace, force: true } },
        })
      ).resolves.toEqual({
        success: true,
        data: { requestId: 'teardown-request-1', seq: 1, outcome: 'accepted' },
      });
      expect(operationRecords.snapshot().records['teardown-request-1']).toMatchObject({
        attempt: 1,
        params: { input: { force: true } },
      });

      runtime.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cancels pending submitted operation records', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'emdash-workspace-runtime-'));
    try {
      const workspace = hostFileRefFromNative(root);
      const operationRecords = createMemoryWorkspaceOperationRecordStore({ now: () => 500 });
      const runtime = new WorkspaceRuntime({ operationRecords, now: () => 500 });
      await operationRecords.appendRecord({
        requestId: 'teardown-request-2',
        kind: 'teardown',
        workspace,
        params: { kind: 'teardown', input: { workspace, force: true } },
        status: 'pending',
      });

      await expect(runtime.cancelOperation('teardown-request-2')).resolves.toEqual({
        success: true,
        data: { requestId: 'teardown-request-2', status: 'cancelled' },
      });
      expect(operationRecords.snapshot().records['teardown-request-2']).toMatchObject({
        status: 'cancelled',
        error: { type: 'cancelled' },
      });

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
