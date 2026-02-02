import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook to auto-scroll terminal containers to bottom when task switches
 */
type ScrollOptions = {
  /**
   * Only scroll if the user is already near the bottom of the pane (avoids yanking them
   * away from where they were reading).
   */
  onlyIfNearBottom?: boolean;
};

export function useAutoScrollOnTaskSwitch(isActive: boolean, taskId: string | null) {
  const previousTaskIdRef = useRef<string | null>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = useCallback((options: ScrollOptions = {}) => {
    const { onlyIfNearBottom = true } = options;

    // Restrict to terminal panes so we don't accidentally scroll unrelated panels.
    const selectors = [
      '.terminal-pane .xterm-viewport',
      '.terminal-pane [data-terminal-container]',
    ];
    const containers = selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
    );

    let scrolledAny = false;

    containers.forEach((container) => {
      const isVisible =
        container.offsetParent !== null &&
        container.getClientRects().length > 0 &&
        container.clientHeight > 0;
      const hasScrollableContent = container.scrollHeight > container.clientHeight;
      const distanceFromBottom =
        container.scrollHeight - (container.scrollTop + container.clientHeight);
      const nearBottom = distanceFromBottom <= 32;

      if (!isVisible || !hasScrollableContent) return;
      if (onlyIfNearBottom && !nearBottom) return;

      container.scrollTo({
        top: container.scrollHeight,
        left: 0,
        behavior: 'instant',
      });
      scrolledAny = true;
    });

    if (process.env.NODE_ENV === 'development' && !scrolledAny) {
      console.debug('[useAutoScrollOnTaskSwitch] No scrollable terminal containers found');
    }
  }, []);

  useEffect(() => {
    if (!isActive || !taskId) {
      return;
    }

    // Check if task actually changed
    if (previousTaskIdRef.current !== taskId) {
      previousTaskIdRef.current = taskId;

      // Clear any existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Delay scroll to allow content to render
      scrollTimeoutRef.current = setTimeout(() => {
        scrollToBottom({ onlyIfNearBottom: false });
      }, 200);
    }

    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [isActive, taskId, scrollToBottom]);

  // Expose a manual scroll function for external use
  return { scrollToBottom };
}
