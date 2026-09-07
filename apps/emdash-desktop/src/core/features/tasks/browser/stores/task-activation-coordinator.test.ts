import { observable } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectHostAccessState } from '@core/features/projects/api/browser/stores/project-context';
import { taskManagerStoreToken } from '@core/features/tasks/contributions/browser/project-store-tokens';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import type { ViewRef } from '@core/primitives/views/api';
import { TaskActivationCoordinator } from './task-activation-coordinator';

describe('TaskActivationCoordinator', () => {
  it('activates a restored Task when its Host becomes ready without a view remount', async () => {
    const currentRef = observable.box<ViewRef>(homeViewDef());
    const hostState = observable.box<ProjectHostAccessState>({
      kind: 'degraded',
      situation: 'attaching',
      recovery: 'automatic',
    });
    const task = observable({
      state: 'unprovisioned' as const,
      phase: 'idle' as const,
      data: { id: 'task-1', projectId: 'project-1', archivedAt: undefined },
    });
    const provisionTask = vi.fn(async () => ({
      kind: 'deferred' as const,
      reason: 'host-unavailable' as const,
    }));
    const taskManager = {
      tasks: observable.map([['task-1', task]]),
      provisionTask,
    };
    const projects = observable.map<string, unknown>();
    const coordinator = new TaskActivationCoordinator(
      {
        get currentRef() {
          return currentRef.get();
        },
      } as never,
      { projects } as never
    );
    coordinator.start();

    currentRef.set(taskViewDef({ projectId: 'project-1', taskId: 'task-1' }));
    expect(coordinator.state).toEqual({
      kind: 'waiting-for-project',
      projectId: 'project-1',
      taskId: 'task-1',
    });

    projects.set('project-1', {
      context: {
        kind: 'available',
        context: {
          host: {
            get state() {
              return hostState.get();
            },
            get liveAction() {
              const state = hostState.get();
              return state.kind === 'ready'
                ? { kind: 'enabled' as const }
                : { kind: 'disabled' as const, state };
            },
          },
          get: (token: unknown) => {
            expect(token).toBe(taskManagerStoreToken);
            return taskManager;
          },
        },
      },
    });
    expect(coordinator.state).toEqual({
      kind: 'waiting-for-host',
      projectId: 'project-1',
      taskId: 'task-1',
    });
    expect(provisionTask).not.toHaveBeenCalled();

    hostState.set({ kind: 'ready', hostGeneration: 1 });
    await vi.waitFor(() => expect(provisionTask).toHaveBeenCalledOnce());
    expect(coordinator.state).toEqual({
      kind: 'ready-to-activate',
      projectId: 'project-1',
      taskId: 'task-1',
      hostGeneration: 1,
    });

    hostState.set({ kind: 'degraded', situation: 'recovering', recovery: 'automatic' });
    hostState.set({ kind: 'ready', hostGeneration: 2 });
    await vi.waitFor(() => expect(provisionTask).toHaveBeenCalledTimes(2));

    coordinator.dispose();
    hostState.set({ kind: 'degraded', situation: 'recovering', recovery: 'automatic' });
    hostState.set({ kind: 'ready', hostGeneration: 3 });
    expect(provisionTask).toHaveBeenCalledTimes(2);
  });

  it('does not activate an archived Task', () => {
    const currentRef = observable.box<ViewRef>(
      taskViewDef({ projectId: 'project-1', taskId: 'task-1' })
    );
    const provisionTask = vi.fn();
    const projects = observable.map([
      [
        'project-1',
        {
          context: {
            kind: 'available' as const,
            context: {
              host: {
                state: { kind: 'ready' as const, hostGeneration: 1 },
                liveAction: { kind: 'enabled' as const },
              },
              get: () => ({
                tasks: observable.map([
                  [
                    'task-1',
                    observable({
                      state: 'unprovisioned' as const,
                      phase: 'idle' as const,
                      data: {
                        id: 'task-1',
                        projectId: 'project-1',
                        archivedAt: '2026-08-28T00:00:00.000Z',
                      },
                    }),
                  ],
                ]),
                provisionTask,
              }),
            },
          },
        },
      ],
    ]);
    const coordinator = new TaskActivationCoordinator(
      {
        get currentRef() {
          return currentRef.get();
        },
      } as never,
      { projects } as never
    );

    coordinator.start();

    expect(coordinator.state).toEqual({
      kind: 'inactive',
      reason: 'archived',
      projectId: 'project-1',
      taskId: 'task-1',
    });
    expect(provisionTask).not.toHaveBeenCalled();
    coordinator.dispose();
  });
});
