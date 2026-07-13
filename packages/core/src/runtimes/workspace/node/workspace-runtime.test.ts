import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok } from '@emdash/shared';
import type { LiveJobContext } from '@emdash/wire';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { hostFileRef, parseAbsolute, type HostFileRef } from '@primitives/path/api';
import type { WorkspaceOperationProgress } from '@runtimes/workspace/api';
import { describe, expect, it, vi } from 'vitest';
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
