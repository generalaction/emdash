import { describe, expect, it, vi } from 'vitest';
import { FocusTracker } from '@renderer/utils/focus-tracker';

describe('FocusTracker', () => {
  it('emits exited focus state with duration on transition', () => {
    const tracker = new FocusTracker();
    const emit = vi.fn();
    tracker.setTransitionEmitter(emit);

    tracker.initialize({ view: 'home', mainPanel: null, rightPanel: null, focusedRegion: null });
    tracker.transition({ view: 'task', mainPanel: 'agents' }, 'navigation');

    expect(emit).toHaveBeenCalledTimes(1);
    const payload = emit.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.view).toBe('home');
    expect(payload.trigger).toBe('navigation');
    expect(typeof payload.duration_ms).toBe('number');
  });
});
