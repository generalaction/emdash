import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { err, ok } from '@emdash/shared';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import { ActivityAggregator, type ActivityProvider, type SessionInfo } from '../workspace-activity';
import {
  createWorkspaceLifecycleController,
  workspaceLifecycleContract,
  WorkspaceLifecycleManager,
} from '../workspace-lifecycle';
import { createTestRepository } from '../workspace-lifecycle/test-utils';
import { WorkspaceCoordinator, type SessionRuntimePort } from './coordinator';
import type { CoordinatorProgress, SessionStartSpec } from './schema';

describe('WorkspaceCoordinator', () => {
  it('skips empty setup and runs activation scripts before starting sessions', async () => {
    const composition = await createComposition();
    try {
      const workspacePath = path.join(composition.repo.root, 'workspace');
      await mkdir(workspacePath, { recursive: true });
      const events: string[] = [];
      composition.sessions.onStart = async () => {
        await expect(readFile(path.join(workspacePath, 'activated.txt'), 'utf8')).resolves.toBe(
          'activated\n'
        );
        events.push('start');
        return ok(undefined);
      };

      const progress: CoordinatorProgress[] = [];
      const result = await composition.coordinator.activate(
        {
          ref: { kind: 'directory', path: workspacePath },
          context: { repoPath: workspacePath, preservePatterns: [] },
          setupPlan: emptyPlan(),
          activationPlan: runScriptPlan(
            'activation-scripts:1',
            'activate',
            'echo activated > activated.txt'
          ),
          sessions: [{ runtime: 'fake', sessionId: 'session-1', input: {} }],
        },
        jobCtx('activate', progress)
      );

      expect(result).toEqual({ success: true, data: { path: workspacePath } });
      expect(events).toEqual(['start']);
      expect(progress.some((entry) => entry.stages[0].status === 'skipped')).toBe(true);
      expect(progress.at(-1)?.stages.map((stage) => stage.status)).toEqual([
        'skipped',
        'done',
        'done',
      ]);
    } finally {
      await composition.dispose();
    }
  });

  it('stops sessions before deactivation scripts run', async () => {
    const composition = await createComposition();
    try {
      const workspacePath = path.join(composition.repo.root, 'workspace');
      await mkdir(workspacePath, { recursive: true });
      const events: string[] = [];
      composition.sessions.onStop = async () => {
        await expect(stat(path.join(workspacePath, 'deactivated.txt'))).rejects.toThrow();
        events.push('stop');
        return ok(undefined);
      };

      const result = await composition.coordinator.deactivate(
        {
          ref: { kind: 'directory', path: workspacePath },
          context: { repoPath: workspacePath, preservePatterns: [] },
          deactivationPlan: runScriptPlan(
            'deactivation-scripts:1',
            'deactivate',
            'echo deactivated > deactivated.txt'
          ),
          strategy: 'stop',
        },
        jobCtx('deactivate')
      );

      expect(result).toEqual({ success: true, data: { path: workspacePath } });
      expect(events).toEqual(['stop']);
      await expect(readFile(path.join(workspacePath, 'deactivated.txt'), 'utf8')).resolves.toBe(
        'deactivated\n'
      );
    } finally {
      await composition.dispose();
    }
  });

  it('vetoes teardown while active and succeeds with force', async () => {
    const composition = await createComposition();
    try {
      const workspacePath = path.join(composition.repo.root, 'workspace');
      await mkdir(workspacePath, { recursive: true });
      composition.activity.addProvider(
        fakeActivityProvider('fake', [session('fake', 'session-1', workspacePath)])
      );

      const blocked = await composition.coordinator.teardown(
        {
          ref: { kind: 'directory', path: workspacePath },
          context: { repoPath: workspacePath, preservePatterns: [] },
          deactivationPlan: emptyPlan(),
          teardownPlan: removeDirectoryPlan(workspacePath),
        },
        jobCtx('teardown-blocked')
      );

      expect(blocked).toMatchObject({
        success: false,
        error: {
          type: 'workspace-busy',
          holders: ['fake:session-1'],
          resolutions: ['force'],
        },
      });

      const forced = await composition.coordinator.teardown(
        {
          ref: { kind: 'directory', path: workspacePath },
          context: { repoPath: workspacePath, preservePatterns: [] },
          deactivationPlan: emptyPlan(),
          teardownPlan: removeDirectoryPlan(workspacePath),
          force: true,
        },
        jobCtx('teardown-forced')
      );

      expect(forced).toEqual({ success: true, data: { path: workspacePath } });
      await expect(stat(workspacePath)).rejects.toThrow();
    } finally {
      await composition.dispose();
    }
  });

  it('forwards lifecycle job progress into coordinator stage progress', async () => {
    const composition = await createComposition();
    try {
      const workspacePath = path.join(composition.repo.root, 'workspace');
      const progress: CoordinatorProgress[] = [];

      const result = await composition.coordinator.activate(
        {
          ref: { kind: 'directory', path: workspacePath },
          context: { repoPath: workspacePath, preservePatterns: [] },
          setupPlan: createDirectoryPlan(workspacePath),
          activationPlan: emptyPlan(),
          sessions: [],
        },
        jobCtx('activate-progress', progress)
      );

      expect(result.success).toBe(true);
      expect(
        progress.some((entry) =>
          entry.stages.some((stage) => stage.id === 'setup' && stage.progress?.message)
        )
      ).toBe(true);
    } finally {
      await composition.dispose();
    }
  });

  it('marks remaining stages skipped when cancellation fails a running stage', async () => {
    const composition = await createComposition();
    try {
      const workspacePath = path.join(composition.repo.root, 'workspace');
      await mkdir(workspacePath, { recursive: true });
      const abort = new AbortController();
      composition.sessions.onStop = async (_path, _strategy, meta) => {
        await new Promise<void>((resolve) =>
          meta.signal.addEventListener('abort', () => resolve())
        );
        return err({
          type: 'cancelled',
          message: 'cancelled',
        });
      };

      const progress: CoordinatorProgress[] = [];
      const run = composition.coordinator.teardown(
        {
          ref: { kind: 'directory', path: workspacePath },
          context: { repoPath: workspacePath, preservePatterns: [] },
          deactivationPlan: runScriptPlan('deactivation-scripts:1', 'deactivate', 'echo never'),
          teardownPlan: removeDirectoryPlan(workspacePath),
          force: true,
        },
        jobCtx('teardown-cancel', progress, abort.signal)
      );

      await expect
        .poll(() => progress.some((entry) => entry.stages[1]?.status === 'running'))
        .toBe(true);
      abort.abort();

      const result = await run;
      expect(result).toMatchObject({
        success: false,
        error: { type: 'cancelled', stageId: 'dehydrate' },
      });
      expect(progress.at(-1)?.stages.map((stage) => stage.status)).toEqual([
        'done',
        'failed',
        'skipped',
        'skipped',
      ]);
    } finally {
      await composition.dispose();
    }
  });
});

async function createComposition(providers: ActivityProvider[] = []) {
  const repo = await createTestRepository();
  const lifecycleManager = new WorkspaceLifecycleManager();
  const lifecycleController = createWorkspaceLifecycleController(lifecycleManager);
  const lifecycleWire = createTestWire(workspaceLifecycleContract, lifecycleController);
  const lifecycle = lifecycleWire.client;
  const activity = new ActivityAggregator(providers);
  const sessions = new FakeSessionRuntime();
  const coordinator = new WorkspaceCoordinator({
    lifecycle,
    sessions,
    activity,
  });

  return {
    repo,
    sessions,
    activity,
    coordinator,
    async dispose() {
      activity.dispose();
      lifecycleWire.dispose();
      lifecycleManager.dispose();
      await repo.cleanup();
    },
  };
}

class FakeSessionRuntime implements SessionRuntimePort {
  onStart: (
    spec: SessionStartSpec,
    meta: { workspacePath: string; signal: AbortSignal }
  ) => Promise<ReturnType<SessionRuntimePort['start']>> | ReturnType<SessionRuntimePort['start']> =
    async () => ok(undefined);

  onStop: SessionRuntimePort['stopForWorkspace'] = async () => ok(undefined);

  async start(
    spec: SessionStartSpec,
    meta: { workspacePath: string; signal: AbortSignal }
  ): ReturnType<SessionRuntimePort['start']> {
    return await this.onStart(spec, meta);
  }

  async stopForWorkspace(
    path: string,
    strategy: 'stop' | 'detach',
    meta: { signal: AbortSignal }
  ): ReturnType<SessionRuntimePort['stopForWorkspace']> {
    return await this.onStop(path, strategy, meta);
  }
}

function jobCtx(
  jobId: string,
  progress: CoordinatorProgress[] = [],
  signal = new AbortController().signal
) {
  return {
    jobId,
    signal,
    progress: vi.fn((entry: CoordinatorProgress) => progress.push(entry)),
  };
}

function emptyPlan() {
  return { steps: [] };
}

function createDirectoryPlan(workspacePath: string) {
  return {
    steps: [
      {
        id: 'create-directory:1',
        label: 'Create directory',
        step: { kind: 'create-directory', args: { path: workspacePath } },
      },
    ],
  };
}

function removeDirectoryPlan(workspacePath: string) {
  return {
    steps: [
      {
        id: 'remove-directory:1',
        label: 'Remove directory',
        step: { kind: 'remove-directory', args: { path: workspacePath } },
      },
    ],
  };
}

function runScriptPlan(id: string, scriptId: string, command: string) {
  return {
    steps: [
      {
        id,
        label: `Run ${scriptId}`,
        step: {
          kind: 'run-script',
          args: { id: scriptId, command, cwd: 'repo' },
        },
      },
    ],
  };
}

function fakeActivityProvider(runtime: string, sessions: SessionInfo[]): ActivityProvider {
  return {
    runtime,
    attach(onSessions) {
      onSessions(sessions);
      return () => onSessions([]);
    },
  };
}

function session(runtime: string, sessionId: string, workspacePath: string): SessionInfo {
  return {
    runtime,
    sessionId,
    workspacePath,
    status: 'running',
    startedAt: 1,
  };
}
