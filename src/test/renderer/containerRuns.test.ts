import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerEvent } from '@shared/container';

const {
  startRunMock,
  onRunEventMock,
  removeRunListenersMock,
  triggerEvent,
  windowMock,
} = vi.hoisted(() => {
  const startRunMock = vi.fn();
  let handler: ((event: RunnerEvent) => void) | undefined;
  const onRunEventMock = vi.fn((cb: (event: RunnerEvent) => void) => {
    handler = cb;
    return () => {
      handler = undefined;
    };
  });
  const removeRunListenersMock = vi.fn();
  const windowMock = {
    electronAPI: {
      startContainerRun: startRunMock,
      onRunEvent: onRunEventMock,
      removeRunEventListeners: removeRunListenersMock,
    },
  } as const;

  return {
    startRunMock,
    onRunEventMock,
    removeRunListenersMock,
    triggerEvent: (event: RunnerEvent) => handler?.(event),
    windowMock,
  };
});

const { infoMock } = vi.hoisted(() => {
  const infoMock = vi.fn();
  return { infoMock };
});

vi.stubGlobal('window', windowMock as any);

vi.mock('../../renderer/lib/logger', () => ({
  log: {
    info: infoMock,
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// eslint-disable-next-line import/first
import {
  startContainerRun,
  subscribeToContainerRuns,
  resetContainerRunListeners,
} from '../../renderer/lib/containerRuns';

describe('containerRuns renderer bridge', () => {
  beforeEach(() => {
    startRunMock.mockReset();
    onRunEventMock.mockClear();
    removeRunListenersMock.mockClear();
    infoMock.mockReset();
    resetContainerRunListeners();
  });

  it('invokes electron bridge when starting a run and trims inputs', async () => {
    startRunMock.mockResolvedValue({ ok: true, runId: 'run-1', sourcePath: null });

    const result = await startContainerRun({
      workspaceId: ' ws-1 ',
      workspacePath: ' /tmp/workspace ',
    });

    expect(startRunMock).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      workspacePath: '/tmp/workspace',
    });
    expect(result).toEqual({ ok: true, runId: 'run-1', sourcePath: null });
    expect(onRunEventMock).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers and logs run events', () => {
    const events: RunnerEvent[] = [];
    const unsubscribe = subscribeToContainerRuns((event) => events.push(event));

    const sample: RunnerEvent = {
      ts: 1700000000000,
      workspaceId: 'ws-1',
      runId: 'run-2',
      mode: 'container',
      type: 'lifecycle',
      status: 'starting',
    };

    triggerEvent(sample);

    expect(events).toEqual([sample]);
    expect(infoMock).toHaveBeenCalledWith('[containers] runner event', sample);

    unsubscribe();
  });

  it('re-registers listener after reset', async () => {
    startRunMock.mockResolvedValue({ ok: true, runId: 'run-3', sourcePath: null });

    await startContainerRun({ workspaceId: 'ws-1', workspacePath: '/tmp/workspace' });
    expect(onRunEventMock).toHaveBeenCalledTimes(1);

    resetContainerRunListeners();
    await startContainerRun({ workspaceId: 'ws-1', workspacePath: '/tmp/workspace' });
    expect(onRunEventMock).toHaveBeenCalledTimes(2);
  });
});
