import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBootWatchdog } from './boot-watchdog';
import { step } from './phase';

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('boot watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the stuck phase stack when boot hangs', async () => {
    const onTrigger = vi.fn();
    startBootWatchdog({ onTrigger, timeoutMs: 60_000 });

    let releaseInner: () => void = () => {};
    const hung = step('services', () =>
      step(
        'services:automations-init',
        () =>
          new Promise<void>((resolve) => {
            releaseInner = resolve;
          })
      )
    );

    await vi.advanceTimersByTimeAsync(60_000);

    expect(onTrigger).toHaveBeenCalledOnce();
    expect(onTrigger).toHaveBeenCalledWith({
      stuckPhase: 'services > services:automations-init',
    });

    releaseInner();
    await hung;
  });

  it('reports a placeholder when no phase is running', async () => {
    const onTrigger = vi.fn();
    startBootWatchdog({ onTrigger, timeoutMs: 60_000 });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(onTrigger).toHaveBeenCalledWith({ stuckPhase: '(no boot phase running)' });
  });

  it('never triggers after disarm', async () => {
    const onTrigger = vi.fn();
    const watchdog = startBootWatchdog({ onTrigger, timeoutMs: 60_000 });

    watchdog.disarm();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(onTrigger).not.toHaveBeenCalled();
  });
});
