import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@main/lib/result';
import { loopUpdatedChannel } from '@shared/core/loops/loopEvents';
import type { Loop, LoopWithPhases } from '@shared/core/loops/loops';
import { LoopService } from './loop-service';
import { getLoop, pauseRunningLoopsForBoot, updateLoop } from './operations/loop-operations';

const emitMock = vi.hoisted(() => vi.fn());
const pauseRunningLoopsForBootMock = vi.hoisted(() => vi.fn());
const resolveTaskWorkspaceTargetMock = vi.hoisted(() => vi.fn());

vi.mock('@main/lib/events', () => ({
  events: { emit: emitMock },
}));

vi.mock('./operations/loop-operations', () => ({
  createLoop: vi.fn(),
  deleteLoop: vi.fn(),
  getLoop: vi.fn(),
  getLoopsForProject: vi.fn(),
  pauseRunningLoopsForBoot: pauseRunningLoopsForBootMock,
  resetPhaseForRetry: vi.fn(),
  updateLoop: vi.fn(),
  updatePhase: vi.fn(),
}));

vi.mock('./drivers/driver-registry', () => ({
  getLoopSessionDriver: vi.fn(),
}));

vi.mock('@main/core/workspaces/resolve-task-workspace-target', () => ({
  resolveTaskWorkspaceTarget: resolveTaskWorkspaceTargetMock,
}));

const loop: Loop = {
  id: 'loop-1',
  projectId: 'project-1',
  taskId: 'task-1',
  name: 'Loop',
  slug: 'loop',
  status: 'paused',
  currentPhaseIndex: 0,
  config: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('LoopService boot recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks running loops paused on initialize and emits loop updates', async () => {
    vi.mocked(pauseRunningLoopsForBoot).mockResolvedValue([loop]);

    await new LoopService().initialize();

    expect(pauseRunningLoopsForBoot).toHaveBeenCalledOnce();
    expect(emitMock).toHaveBeenCalledWith(loopUpdatedChannel, { loop });
  });
});

describe('LoopService start and resume workspace resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTaskWorkspaceTargetMock.mockResolvedValue({
      success: true,
      data: { workspaceId: 'workspace-1', path: '/tmp/worktree', machine: { kind: 'local' } },
    });
    vi.mocked(getLoop).mockResolvedValue({ ...loop, phases: [] } satisfies LoopWithPhases);
    vi.mocked(updateLoop).mockImplementation(async (_loopId, patch) => ok({ ...loop, ...patch }));
  });

  it('starts a loop using a resolved workspace path even when no workspace is mounted', async () => {
    const result = await new LoopService().startLoop('loop-1');

    expect(resolveTaskWorkspaceTargetMock).toHaveBeenCalledWith('task-1');
    expect(updateLoop).toHaveBeenCalledWith('loop-1', { status: 'running' });
    expect(result.success).toBe(true);
  });

  it('returns a clear workspace error when the resolved worktree path is unavailable', async () => {
    resolveTaskWorkspaceTargetMock.mockResolvedValueOnce({
      success: false,
      error: {
        kind: 'workspace-unavailable',
        message: 'Workspace path no longer exists: /tmp/missing-worktree',
      },
    });

    const result = await new LoopService().startLoop('loop-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.kind).toBe('workspace-unavailable');
      expect(result.error.message).toBe('Workspace path no longer exists: /tmp/missing-worktree');
    }
  });
});
