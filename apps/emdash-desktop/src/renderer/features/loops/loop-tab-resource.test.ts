import { describe, expect, it, vi } from 'vitest';
import type { LoopAuthoringPort, LoopTabEvent, LoopTabSnapshot } from './loop-authoring-port';
import { LoopTabResource } from './loop-tab-resource';

const settings = vi.hoisted(() => ({ loops: true }));
vi.mock('@renderer/features/settings/app-settings-client', () => ({
  getAppSettingValueSnapshot: () => ({ loops: settings.loops }),
}));

function snapshot(patch: Partial<LoopTabSnapshot> = {}): LoopTabSnapshot {
  return {
    loopId: 'loop-1',
    taskId: 'task-1',
    name: 'Native Loop',
    status: 'running',
    currentPhaseIndex: 0,
    phases: [],
    browser: { kind: 'waiting', message: 'Waiting for a preview server.' },
    ...patch,
  };
}

function fakePort(initial = snapshot()): {
  port: LoopAuthoringPort;
  emit(event: LoopTabEvent): void;
  unsubscribe: ReturnType<typeof vi.fn>;
} {
  const listeners = new Set<(event: LoopTabEvent) => void>();
  const unsubscribe = vi.fn();
  return {
    port: {
      loadLoop: vi.fn(async () => initial),
      subscribeToLoop: vi.fn((_loopId, listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          unsubscribe();
        };
      }),
      pauseLoop: vi.fn(async () => snapshot({ status: 'paused' })),
      resumeLoop: vi.fn(async () => snapshot({ status: 'running' })),
      retryPhase: vi.fn(async () => snapshot({ status: 'running' })),
    },
    emit: (event) => {
      for (const listener of listeners) listener(event);
    },
    unsubscribe,
  };
}

describe('LoopTabResource', () => {
  it('loads once on activation and maps port snapshots into ready state', async () => {
    const fake = fakePort();
    const resource = new LoopTabResource('loop-1', fake.port);

    resource.onActivate();
    resource.onActivate();
    await resource.loading;

    expect(fake.port.loadLoop).toHaveBeenCalledTimes(1);
    expect(fake.port.loadLoop).toHaveBeenCalledWith('loop-1');
    expect(fake.port.subscribeToLoop).toHaveBeenCalledWith('loop-1', expect.any(Function));
    expect(resource.state).toEqual({ kind: 'ready', snapshot: snapshot() });
  });

  it('stays inert while disabled and releases subscriptions on live opt-out', async () => {
    settings.loops = false;
    const fake = fakePort();
    const resource = new LoopTabResource('loop-1', fake.port);

    resource.onActivate();
    await resource.load();
    expect(fake.port.loadLoop).not.toHaveBeenCalled();
    expect(fake.port.subscribeToLoop).not.toHaveBeenCalled();

    resource.setEnabled(true);
    await resource.loading;
    resource.setEnabled(false);
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
    expect(resource.state).toEqual({ kind: 'idle' });
    settings.loops = true;
  });

  it('maps subscribed events, including handoff, evidence, and browser state', async () => {
    const fake = fakePort();
    const resource = new LoopTabResource('loop-1', fake.port);
    await resource.load();

    const updated = snapshot({
      status: 'paused',
      phases: [
        {
          id: 'phase-1',
          index: 0,
          kind: 'work',
          name: 'Implementation',
          goal: 'Build the feature',
          status: 'passed',
          attempts: 1,
          lastError: null,
          handoff: {
            summary: 'Implementation complete',
            risks: ['Migration needs review'],
            remainingWork: [],
            artifacts: [],
          },
          evidence: [{ label: 'Unit tests', status: 'passed', summary: '42 tests passed' }],
        },
      ],
      browser: { kind: 'reconnecting', message: 'SSH preview is reconnecting.' },
    });
    fake.emit({ type: 'snapshot', snapshot: updated });

    expect(resource.state).toEqual({ kind: 'ready', snapshot: updated });
  });

  it('delegates pause, resume, and phase retry while exposing pending state', async () => {
    let finishPause: ((value: LoopTabSnapshot) => void) | undefined;
    const fake = fakePort();
    vi.mocked(fake.port.pauseLoop).mockReturnValue(
      new Promise((resolve) => {
        finishPause = resolve;
      })
    );
    const resource = new LoopTabResource('loop-1', fake.port);
    await resource.load();

    const pausing = resource.pause();
    expect(resource.action).toEqual({ kind: 'pending', action: 'pause' });
    finishPause?.(snapshot({ status: 'paused' }));
    await pausing;
    expect(fake.port.pauseLoop).toHaveBeenCalledWith('loop-1');
    expect(resource.action).toEqual({ kind: 'idle' });
    expect(resource.state).toEqual({
      kind: 'ready',
      snapshot: snapshot({ status: 'paused' }),
    });

    await resource.resume();
    await resource.retryPhase('phase-2');
    expect(fake.port.resumeLoop).toHaveBeenCalledWith('loop-1');
    expect(fake.port.retryPhase).toHaveBeenCalledWith('loop-1', 'phase-2');
  });

  it('keeps action failures visible and retryable', async () => {
    const fake = fakePort();
    vi.mocked(fake.port.pauseLoop).mockRejectedValue(new Error('Workspace is disconnected'));
    const resource = new LoopTabResource('loop-1', fake.port);
    await resource.load();

    await resource.pause();

    expect(resource.action).toEqual({
      kind: 'error',
      action: 'pause',
      message: 'Could not pause the Loop: Workspace is disconnected',
    });
    expect(resource.state.kind).toBe('ready');

    vi.mocked(fake.port.pauseLoop).mockResolvedValue(snapshot({ status: 'paused' }));
    await resource.pause();
    expect(resource.action).toEqual({ kind: 'idle' });
    expect(resource.state).toEqual({
      kind: 'ready',
      snapshot: snapshot({ status: 'paused' }),
    });
  });

  it('does not let a stale action response overwrite a newer subscribed snapshot', async () => {
    let finishPause: ((value: LoopTabSnapshot) => void) | undefined;
    const fake = fakePort();
    vi.mocked(fake.port.pauseLoop).mockReturnValue(
      new Promise((resolve) => {
        finishPause = resolve;
      })
    );
    const resource = new LoopTabResource('loop-1', fake.port);
    await resource.load();

    const pausing = resource.pause();
    const newer = snapshot({ status: 'paused', currentPhaseIndex: 2 });
    fake.emit({ type: 'snapshot', snapshot: newer });
    finishPause?.(snapshot({ status: 'running', currentPhaseIndex: 0 }));
    await pausing;

    expect(resource.action).toEqual({ kind: 'idle' });
    expect(resource.state).toEqual({ kind: 'ready', snapshot: newer });
  });

  it('does not let an older overlapping load overwrite the newest load result', async () => {
    let finishFirst: ((value: LoopTabSnapshot) => void) | undefined;
    let finishSecond: ((value: LoopTabSnapshot) => void) | undefined;
    const fake = fakePort();
    vi.mocked(fake.port.loadLoop)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirst = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishSecond = resolve;
        })
      );
    const resource = new LoopTabResource('loop-1', fake.port);

    const first = resource.load();
    const second = resource.load();
    const newest = snapshot({ status: 'completed', currentPhaseIndex: 2 });
    finishSecond?.(newest);
    await second;
    finishFirst?.(snapshot({ status: 'running', currentPhaseIndex: 0 }));
    await first;

    expect(resource.state).toEqual({ kind: 'ready', snapshot: newest });
  });

  it('unsubscribes and ignores late events after disposal', async () => {
    const fake = fakePort();
    const resource = new LoopTabResource('loop-1', fake.port);
    await resource.load();
    const before = resource.state;

    resource.dispose();
    fake.emit({ type: 'snapshot', snapshot: snapshot({ status: 'completed' }) });

    expect(fake.unsubscribe).toHaveBeenCalledOnce();
    expect(resource.state).toBe(before);
  });
});
