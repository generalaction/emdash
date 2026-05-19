import type { ReactNode } from 'react';

interface ShowHideProps {
  visible: boolean;
  children: ReactNode;
}

export function ShowHide({ visible, children }: ShowHideProps) {
  return <div style={{ display: visible ? 'contents' : 'none' }}>{children}</div>;
}
