import { describe, expect, it, vi } from 'vitest';
import { createPressureSignal } from '../../api/channel';
import { LiveLogSource } from './source';

describe('LiveLogSource pressure', () => {
  it('aggregates paused state across subscribers and reports only real changes', () => {
    const onPressureChange = vi.fn();
    const source = new LiveLogSource({ onPressureChange });
    const first = createPressureSignal();
    const second = createPressureSignal();

    const unsubscribeFirst = source.subscribe(() => {}, { pressure: first });
    const unsubscribeSecond = source.subscribe(() => {}, { pressure: second });

    first.set(true);
    first.set(true);
    expect(onPressureChange).toHaveBeenCalledTimes(1);
    expect(onPressureChange).toHaveBeenNthCalledWith(1, true);

    second.set(true);
    expect(onPressureChange).toHaveBeenCalledTimes(1);

    first.set(false);
    expect(onPressureChange).toHaveBeenCalledTimes(1);

    second.set(false);
    expect(onPressureChange).toHaveBeenCalledTimes(2);
    expect(onPressureChange).toHaveBeenNthCalledWith(2, false);

    unsubscribeFirst();
    unsubscribeSecond();
  });

  it('unsubscribing a paused subscriber resumes when no other paused subscriber remains', () => {
    const onPressureChange = vi.fn();
    const source = new LiveLogSource({ onPressureChange });
    const signal = createPressureSignal();

    const unsubscribe = source.subscribe(() => {}, { pressure: signal });
    signal.set(true);
    expect(onPressureChange).toHaveBeenLastCalledWith(true);

    unsubscribe();
    expect(onPressureChange).toHaveBeenLastCalledWith(false);
    expect(onPressureChange).toHaveBeenCalledTimes(2);
  });

  it('does not call onPressureChange for subscribers without a pressure signal', () => {
    const onPressureChange = vi.fn();
    const source = new LiveLogSource({ onPressureChange });

    const unsubscribe = source.subscribe(() => {});
    source.append('data');
    expect(onPressureChange).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('watchPressure notifies on pressure changes and can be unsubscribed', () => {
    const source = new LiveLogSource();
    const signal = createPressureSignal();
    const onPressure = vi.fn();

    const unsubscribeClient = source.subscribe(() => {}, { pressure: signal });
    const stopWatching = source.watchPressure(onPressure);
    expect(onPressure).not.toHaveBeenCalled();

    signal.set(true);
    expect(onPressure).toHaveBeenCalledTimes(1);
    expect(onPressure).toHaveBeenLastCalledWith(true);

    signal.set(false);
    expect(onPressure).toHaveBeenCalledTimes(2);
    expect(onPressure).toHaveBeenLastCalledWith(false);

    stopWatching();
    signal.set(true);
    expect(onPressure).toHaveBeenCalledTimes(2);

    unsubscribeClient();
  });

  it('watchPressure reports immediately, and only, when already paused', () => {
    const source = new LiveLogSource();
    const signal = createPressureSignal();
    const unsubscribeClient = source.subscribe(() => {}, { pressure: signal });
    signal.set(true);

    const pausedWatcher = vi.fn();
    const stopPausedWatching = source.watchPressure(pausedWatcher);
    expect(pausedWatcher).toHaveBeenCalledTimes(1);
    expect(pausedWatcher).toHaveBeenCalledWith(true);

    stopPausedWatching();
    signal.set(false);

    const idleWatcher = vi.fn();
    const stopIdleWatching = source.watchPressure(idleWatcher);
    expect(idleWatcher).not.toHaveBeenCalled();

    signal.set(true);
    expect(idleWatcher).toHaveBeenCalledTimes(1);
    expect(idleWatcher).toHaveBeenCalledWith(true);

    stopIdleWatching();
    unsubscribeClient();
  });
});
