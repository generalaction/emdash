import type { ReactNode } from 'react';
import { useRef } from 'react';

interface ShowHideProps {
  visible: boolean;
  children: ReactNode;
  lazy?: boolean;
}

export function ShowHide({ visible, children, lazy = false }: ShowHideProps) {
  const hasBeenVisibleRef = useRef(visible);

  if (visible) {
    hasBeenVisibleRef.current = true;
  }

  if (lazy && !hasBeenVisibleRef.current) {
    return null;
  }

  return <div style={{ display: visible ? 'contents' : 'none' }}>{children}</div>;
}
