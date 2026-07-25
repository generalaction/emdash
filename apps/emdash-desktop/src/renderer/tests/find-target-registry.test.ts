import { describe, expect, it, vi } from 'vitest';
import { FindTargetRegistry } from '@renderer/lib/find/find-target-registry';

describe('find-target-registry', () => {
  it('activates the active target', () => {
    const registry = new FindTargetRegistry();
    const openFind = vi.fn();
    registry.register({ id: 'a', openFind });
    registry.setActive('a');

    const handled = registry.activate();

    expect(handled).toBe(true);
    expect(openFind).toHaveBeenCalledTimes(1);
  });

  it('returns false when there is no active target', () => {
    const registry = new FindTargetRegistry();
    registry.register({ id: 'a', openFind: vi.fn() });

    expect(registry.activate()).toBe(false);
  });

  it('returns false when the active target was unregistered', () => {
    const registry = new FindTargetRegistry();
    const unregister = registry.register({ id: 'a', openFind: vi.fn() });
    registry.setActive('a');
    unregister();

    expect(registry.activate()).toBe(false);
  });

  it('last setActive call wins', () => {
    const registry = new FindTargetRegistry();
    const openFindA = vi.fn();
    const openFindB = vi.fn();
    registry.register({ id: 'a', openFind: openFindA });
    registry.register({ id: 'b', openFind: openFindB });

    registry.setActive('a');
    registry.setActive('b');
    registry.activate();

    expect(openFindA).not.toHaveBeenCalled();
    expect(openFindB).toHaveBeenCalledTimes(1);
  });

  it('unregistering a non-active target does not clear activeId', () => {
    const registry = new FindTargetRegistry();
    const openFindA = vi.fn();
    const unregisterB = registry.register({ id: 'b', openFind: vi.fn() });
    registry.register({ id: 'a', openFind: openFindA });
    registry.setActive('a');

    unregisterB();
    registry.activate();

    expect(openFindA).toHaveBeenCalledTimes(1);
  });

  describe('focused vs. visibility-only activation', () => {
    // Regression coverage for a real bug: an ACP task view can show two
    // terminal panes at once (the main conversation PTY and a separate
    // "Terminal 1" side panel). Both register with the registry and both
    // become visible, but only one is ever genuinely focused. Before this
    // fix, setActive had no notion of focus vs. mere visibility, so
    // whichever pane's IntersectionObserver fired last won activation —
    // making Cmd+F/Edit>Find hit the wrong pane depending on render timing,
    // not on where the user actually clicked.

    it('a visibility-only claim does not steal from a focused target', () => {
      const registry = new FindTargetRegistry();
      const openFindA = vi.fn();
      const openFindB = vi.fn();
      registry.register({ id: 'a', openFind: openFindA });
      registry.register({ id: 'b', openFind: openFindB });

      registry.setActive('a'); // genuine focus claim (default)
      registry.setActive('b', { focused: false }); // merely became visible

      registry.activate();
      expect(openFindA).toHaveBeenCalledTimes(1);
      expect(openFindB).not.toHaveBeenCalled();
    });

    it('a focused claim always wins, even over an existing focus claim on another target', () => {
      const registry = new FindTargetRegistry();
      const openFindA = vi.fn();
      const openFindB = vi.fn();
      registry.register({ id: 'a', openFind: openFindA });
      registry.register({ id: 'b', openFind: openFindB });

      registry.setActive('a');
      registry.setActive('b'); // genuine focus moved to b

      registry.activate();
      expect(openFindB).toHaveBeenCalledTimes(1);
      expect(openFindA).not.toHaveBeenCalled();
    });

    it('a visibility-only claim can still supersede another visibility-only claim', () => {
      // Matches the sidebar tab-switch case: a display:none-toggled panel
      // becoming visible (not focused) should still be able to claim
      // activation from a sibling that was only ever visibility-claimed too.
      const registry = new FindTargetRegistry();
      const openFindA = vi.fn();
      const openFindB = vi.fn();
      registry.register({ id: 'a', openFind: openFindA });
      registry.register({ id: 'b', openFind: openFindB });

      registry.setActive('a', { focused: false });
      registry.setActive('b', { focused: false });

      registry.activate();
      expect(openFindB).toHaveBeenCalledTimes(1);
      expect(openFindA).not.toHaveBeenCalled();
    });

    it('clearing activation (setActive(null)) always takes effect, even over a focus claim', () => {
      const registry = new FindTargetRegistry();
      const openFindA = vi.fn();
      registry.register({ id: 'a', openFind: openFindA });

      registry.setActive('a');
      registry.setActive(null);

      expect(registry.activate()).toBe(false);
      expect(openFindA).not.toHaveBeenCalled();
    });

    it('a visibility-only claim wins when nothing is currently active', () => {
      const registry = new FindTargetRegistry();
      const openFindA = vi.fn();
      registry.register({ id: 'a', openFind: openFindA });

      registry.setActive('a', { focused: false });

      registry.activate();
      expect(openFindA).toHaveBeenCalledTimes(1);
    });
  });
});
