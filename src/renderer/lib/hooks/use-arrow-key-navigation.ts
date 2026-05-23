import { useEffect, useRef, useState } from 'react';
import { modalStore } from '@renderer/lib/modal/modal-store';

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
      if (modalStore.isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % count);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + count) % count);
      } else if (e.key === 'Enter') {
        onEnterRef.current(selectedIndexRef.current);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [count]);

  return { selectedIndex, setSelectedIndex };
}
