import { useCallback, useEffect, useRef } from 'react';

const STICK_THRESHOLD_PX = 48; // how close to the bottom before we consider "stuck"

/**
 * Hook implementing stick-to-bottom scrolling for a virtual list.
 *
 * Returns a ref to attach to the scroll container and a function to call
 * whenever new items are added or heights change.  The hook automatically
 * scrolls to the bottom only when the user is already at (or near) the bottom.
 *
 * @returns [containerRef, scheduleScrollCheck]
 */
export function useStickToBottom(): [
  containerRef: React.RefObject<HTMLElement | null>,
  scheduleScrollCheck: () => void,
] {
  const containerRef = useRef<HTMLElement | null>(null);
  const isStuck = useRef(true);
  const rafId = useRef<number | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight - el.clientHeight;
  }, []);

  const scheduleScrollCheck = useCallback(() => {
    if (!isStuck.current) return;
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      if (isStuck.current) scrollToBottom();
    });
  }, [scrollToBottom]);

  // Track whether the user has scrolled away from the bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
      isStuck.current = distanceFromBottom <= STICK_THRESHOLD_PX;
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Cancel any pending rAF on unmount
  useEffect(() => {
    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return [containerRef, scheduleScrollCheck];
}
