import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findTargetRegistry } from '@renderer/lib/find/find-target-registry';
import { useFindTargetActivation } from '@renderer/lib/find/use-find-target-activation';

function Probe({ targetId, hidden }: { targetId: string; hidden: boolean }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  useFindTargetActivation({ containerRef, targetId, enabled: true });
  return (
    <div ref={containerRef} style={{ display: hidden ? 'none' : 'block' }}>
      content
    </div>
  );
}

// A real IntersectionObserver's callback fires asynchronously even when the
// browser project runs against genuine Chromium, so tests must wait a couple
// of frames for it to run before asserting.
function waitForObserver(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

describe('useFindTargetActivation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    findTargetRegistry.setActive(null);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    findTargetRegistry.setActive(null);
  });

  it('claims activation as soon as a hidden target becomes visible, with no hover or focus', async () => {
    // Regression coverage: sibling panels toggled via `display: none` (e.g.
    // TaskSidebar's ShowHide-wrapped file tree / conversations list) stay
    // mounted the whole time. Switching tabs by clicking doesn't move the
    // mouse or focus into the newly-shown panel, so a stale activeId from
    // whichever panel was hovered last would otherwise stick around — Cmd+F
    // / Edit > Find would silently do nothing, or hit the wrong, now-hidden
    // target.
    let openedOther = false;
    const unregisterOther = findTargetRegistry.register({
      id: 'other-panel',
      openFind: () => {
        openedOther = true;
      },
    });
    // Matches how useFindTargetActivation's own IntersectionObserver would
    // have activated this sibling panel earlier — a visibility claim, not a
    // real focus claim — so it can legitimately be superseded by the next
    // panel's own visibility claim below.
    findTargetRegistry.setActive('other-panel', { focused: false });

    let openedFileTree = false;
    const unregisterFileTree = findTargetRegistry.register({
      id: 'file-tree',
      openFind: () => {
        openedFileTree = true;
      },
    });

    act(() => {
      root.render(<Probe targetId="file-tree" hidden />);
    });
    await waitForObserver();

    // Still hidden — must not have stolen activation from the other panel
    // just because it registered.
    findTargetRegistry.activate();
    expect(openedOther).toBe(true);
    expect(openedFileTree).toBe(false);

    // Simulate a tab switch: the sidebar's wrapper flips display: none -> block.
    act(() => {
      root.render(<Probe targetId="file-tree" hidden={false} />);
    });
    await waitForObserver();

    openedOther = false;
    findTargetRegistry.activate();
    expect(openedFileTree).toBe(true);
    expect(openedOther).toBe(false);

    unregisterOther();
    unregisterFileTree();
  });

  it('does not let a merely-visible sibling steal activation from a genuinely focused target', async () => {
    // Regression coverage: an ACP conversation tab renders both a chat
    // transcript (find via useDomTextSearch) and an embedded terminal (find
    // via useTerminalSearch) simultaneously visible in the same view. Both
    // mount and both become intersecting, but the user's actual focus (e.g.
    // clicking into the chat input) must keep winning — a sibling merely
    // becoming visible must not race it for activeId based on
    // mount/observer-callback order.
    let openedFocused = false;
    const unregisterFocused = findTargetRegistry.register({
      id: 'chat-transcript',
      openFind: () => {
        openedFocused = true;
      },
    });
    findTargetRegistry.setActive('chat-transcript'); // genuine focus claim

    let openedSibling = false;
    const unregisterSibling = findTargetRegistry.register({
      id: 'embedded-terminal',
      openFind: () => {
        openedSibling = true;
      },
    });

    act(() => {
      root.render(<Probe targetId="embedded-terminal" hidden={false} />);
    });
    await waitForObserver();

    findTargetRegistry.activate();
    expect(openedFocused).toBe(true);
    expect(openedSibling).toBe(false);

    unregisterFocused();
    unregisterSibling();
  });

  it('does not activate a target that never becomes visible', async () => {
    const unregister = findTargetRegistry.register({ id: 'file-tree', openFind: () => {} });

    act(() => {
      root.render(<Probe targetId="file-tree" hidden />);
    });
    await waitForObserver();

    expect(findTargetRegistry.activate()).toBe(false);
    unregister();
  });

  it('keeps activation when the pointer leaves the viewport entirely, not just the container', async () => {
    // Regression coverage: reaching for the native Edit > Find menu item
    // means moving the mouse off the app's content area and up to the OS
    // menu bar — a mouseleave with relatedTarget === null, since the
    // pointer left the window rather than moving onto another element.
    // Clearing activeId on that event meant Edit > Find silently failed
    // right when the user reached for it, while Cmd+F (which needs no
    // mouse movement) kept working from the same state — an inconsistency
    // between the two paths to the identical dispatch('find') call.
    let opened = false;
    const unregister = findTargetRegistry.register({
      id: 'chat-panel',
      openFind: () => {
        opened = true;
      },
    });

    act(() => {
      root.render(<Probe targetId="chat-panel" hidden={false} />);
    });
    await waitForObserver();

    const el = container.querySelector('div')!;
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    expect(findTargetRegistry.activate()).toBe(true);
    opened = false;

    // Leaving the viewport: relatedTarget is null (not another DOM element).
    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, relatedTarget: null }));
    expect(findTargetRegistry.activate()).toBe(true);
    expect(opened).toBe(true);

    unregister();
  });

  it('still clears activation when the pointer moves onto a real sibling element', async () => {
    let opened = false;
    const unregister = findTargetRegistry.register({
      id: 'chat-panel',
      openFind: () => {
        opened = true;
      },
    });

    act(() => {
      root.render(<Probe targetId="chat-panel" hidden={false} />);
    });
    await waitForObserver();

    const el = container.querySelector('div')!;
    const sibling = document.createElement('div');
    document.body.appendChild(sibling);

    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    expect(findTargetRegistry.activate()).toBe(true);
    opened = false;

    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, relatedTarget: sibling }));
    expect(findTargetRegistry.activate()).toBe(false);
    expect(opened).toBe(false);

    sibling.remove();
    unregister();
  });
});
