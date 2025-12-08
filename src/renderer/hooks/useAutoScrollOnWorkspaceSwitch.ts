import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook to auto-scroll terminal containers to bottom when workspace switches
 */
export function useAutoScrollOnWorkspaceSwitch(
  isActive: boolean,
  workspaceId: string | null
) {
  const previousWorkspaceIdRef = useRef<string | null>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = useCallback(() => {
    // Multiple strategies to find terminal containers
    const selectors = [
      '.terminal-pane [style*="overflow"]',
      '.xterm-viewport',
      '.xterm-screen',
      '[data-terminal-container]',
      '.terminal-pane div[style*="overflow"]',
      'div[style*="overflow:hidden"]' // Common terminal container style
    ];

    let scrolledAny = false;

    selectors.forEach((selector) => {
      const containers = document.querySelectorAll(selector);

      containers.forEach((container) => {
        if (container instanceof HTMLElement) {
          // Check if this terminal container is visible
          const isVisible = container.offsetParent !== null;
          const hasScrollableContent = container.scrollHeight > container.clientHeight;

          if (isVisible && hasScrollableContent) {
            // Scroll to bottom smoothly
            container.scrollTo({
              top: container.scrollHeight,
              left: 0,
              behavior: 'smooth'
            });
            scrolledAny = true;
          }
        }
      });
    });

    // Log for debugging purposes (only in development)
    if (process.env.NODE_ENV === 'development' && !scrolledAny) {
      console.debug('[useAutoScrollOnWorkspaceSwitch] No scrollable terminal containers found');
    }
  }, []);

  useEffect(() => {
    if (!isActive || !workspaceId) {
      return;
    }

    // Check if workspace actually changed
    if (previousWorkspaceIdRef.current !== workspaceId) {
      previousWorkspaceIdRef.current = workspaceId;

      // Clear any existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Delay scroll to allow content to render
      scrollTimeoutRef.current = setTimeout(() => {
        scrollToBottom();
      }, 200);
    }

    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    };
  }, [isActive, workspaceId, scrollToBottom]);

  // Expose a manual scroll function for external use
  return { scrollToBottom };
}