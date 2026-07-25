import { useEffect, type RefObject } from 'react';
import { findTargetRegistry } from './find-target-registry';

interface UseFindTargetActivationOptions {
  containerRef: RefObject<HTMLElement | null>;
  targetId: string;
  enabled: boolean;
}

/**
 * Keeps findTargetRegistry's active target in sync with a container's focus,
 * hover, and visibility state, so Cmd+F (and Edit > Find) reaches whichever
 * find-capable surface the user is actually looking at.
 *
 * Focus/hover alone is not enough: several panels (file tree, conversations
 * list) are siblings that stay mounted and swap via `display: none` when a
 * sidebar tab changes, per ShowHide. Switching tabs by clicking doesn't move
 * the mouse or focus into the newly-shown panel, so a stale activeId from
 * the previously-hovered panel would stick around — Cmd+F would silently do
 * nothing, or activate the wrong (now-hidden) target. An IntersectionObserver
 * catches that transition and claims activation as soon as the container
 * actually becomes visible, without waiting for the user to move the mouse
 * over it first.
 */
export function useFindTargetActivation({
  containerRef,
  targetId,
  enabled,
}: UseFindTargetActivationOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const handleFocusIn = () => findTargetRegistry.setActive(targetId);
    const handleFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null;
      if (next && container.contains(next)) return;
      findTargetRegistry.setActive(null);
    };
    const handleMouseEnter = () => findTargetRegistry.setActive(targetId);
    const handleMouseLeave = (event: MouseEvent) => {
      if (container.contains(document.activeElement)) return;
      // A null relatedTarget means the pointer left the window/viewport
      // entirely (e.g. moving up to the native menu bar to click Edit >
      // Find) rather than moving onto another element in the page. Treat
      // that as "still looking at this pane" — clearing activation here
      // would make Edit > Find silently fail right when the user reaches
      // for it, while Cmd+F (which needs no mouse movement) keeps working.
      // Only clear when the pointer demonstrably moved to a sibling element.
      if (event.relatedTarget === null) return;
      findTargetRegistry.setActive(null);
    };

    if (container.contains(document.activeElement)) {
      findTargetRegistry.setActive(targetId);
    }

    container.addEventListener('focusin', handleFocusIn);
    container.addEventListener('focusout', handleFocusOut);
    container.addEventListener('mouseenter', handleMouseEnter);
    container.addEventListener('mouseleave', handleMouseLeave);

    // IntersectionObserver isn't implemented by every DOM test harness (e.g.
    // plain jsdom without a polyfill); the focus/hover listeners above still
    // cover activation without it, so treat this as optional enhancement.
    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              if (entry?.isIntersecting) {
                findTargetRegistry.setActive(targetId, { focused: false });
              }
            },
            { threshold: 0 }
          )
        : null;
    observer?.observe(container);

    return () => {
      container.removeEventListener('focusin', handleFocusIn);
      container.removeEventListener('focusout', handleFocusOut);
      container.removeEventListener('mouseenter', handleMouseEnter);
      container.removeEventListener('mouseleave', handleMouseLeave);
      observer?.disconnect();
    };
  }, [containerRef, enabled, targetId]);
}
