import { useEffect, useRef, useState } from 'react';
import { modalStore } from '@renderer/lib/modal/modal-store';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.closest(
      'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"]'
    ) !== null
  );
}

function isFromDialog(event: KeyboardEvent): boolean {
  return event
    .composedPath()
    .some((target) => target instanceof HTMLElement && target.dataset.slot === 'dialog-content');
}

export function useArrowKeyNavigation(count: number, onEnter: (index: number) => void) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const onEnterRef = useRef(onEnter);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    onEnterRef.current = onEnter;
  }, [onEnter]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        modalStore.isOpen ||
        isFromDialog(e) ||
        isEditableTarget(e.target) ||
        isInteractiveTarget(e.target)
      ) {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % count);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + count) % count);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onEnterRef.current(selectedIndexRef.current);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [count]);

  return { selectedIndex, setSelectedIndex };
}
