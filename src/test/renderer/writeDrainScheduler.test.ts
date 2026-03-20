import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleTerminalWriteDrain } from '../../renderer/terminal/writeDrainScheduler';

describe('scheduleTerminalWriteDrain', () => {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const globals = globalThis as typeof globalThis & {
    document?: Document;
    requestAnimationFrame?: (callback: (time: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();

    if (originalDocument === undefined) {
      Reflect.deleteProperty(globals, 'document');
    } else {
      globals.document = originalDocument;
    }

    if (originalRequestAnimationFrame === undefined) {
      Reflect.deleteProperty(globals, 'requestAnimationFrame');
    } else {
      globals.requestAnimationFrame = originalRequestAnimationFrame;
    }

    if (originalCancelAnimationFrame === undefined) {
      Reflect.deleteProperty(globals, 'cancelAnimationFrame');
    } else {
      globals.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  it('prefers requestAnimationFrame while visible', () => {
    let frameCallback: ((time: number) => void) | null = null;
    const run = vi.fn();

    globals.document = { visibilityState: 'visible' } as Document;
    globals.requestAnimationFrame = vi.fn((callback: (time: number) => void) => {
      frameCallback = callback;
      return 1;
    });
    globals.cancelAnimationFrame = vi.fn();

    scheduleTerminalWriteDrain(run);

    expect(globals.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();

    expect(frameCallback).not.toBeNull();
    const callback = frameCallback!;
    callback(16);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('falls back to a timeout when the document is hidden', () => {
    const run = vi.fn();

    globals.document = { visibilityState: 'hidden' } as Document;
    globals.requestAnimationFrame = vi.fn();
    globals.cancelAnimationFrame = vi.fn();

    scheduleTerminalWriteDrain(run);

    expect(globals.requestAnimationFrame).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('uses the timeout fallback if requestAnimationFrame never fires', () => {
    const run = vi.fn();

    globals.document = { visibilityState: 'visible' } as Document;
    globals.requestAnimationFrame = vi.fn(() => 7);
    globals.cancelAnimationFrame = vi.fn();

    scheduleTerminalWriteDrain(run);

    vi.runAllTimers();

    expect(run).toHaveBeenCalledTimes(1);
    expect(globals.cancelAnimationFrame).toHaveBeenCalledWith(7);
  });
});
