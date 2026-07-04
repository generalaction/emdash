import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loopUpdatedChannel } from '@shared/core/loops/loopEvents';
import type { Loop } from '@shared/core/loops/loops';
import { LoopService } from './loop-service';
import { pauseRunningLoopsForBoot } from './operations/loop-operations';

const emitMock = vi.hoisted(() => vi.fn());
const pauseRunningLoopsForBootMock = vi.hoisted(() => vi.fn());

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

vi.mock('@main/core/tasks/task-session-manager', () => ({
  taskSessionManager: { getWorkspaceId: vi.fn() },
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: { get: vi.fn() },
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
