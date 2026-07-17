import type { ReactNode } from 'react';
import { AnimatedHeight } from './animated-height';

export function ModalLayout({
  header,
  footer,
  children,
}: {
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {header}
      <AnimatedHeight>{children}</AnimatedHeight>
      {footer}
    </>
  );
}
