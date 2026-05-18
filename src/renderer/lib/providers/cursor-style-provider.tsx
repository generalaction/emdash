import { useLayoutEffect, type ReactNode } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';

const CURSOR_POINTER_CLASS = 'cursor-pointer-enabled';

export function CursorStyleProvider({ children }: { children: ReactNode }) {
  const { value: interfaceSettings, isLoading } = useAppSettingsKey('interface');

  useLayoutEffect(() => {
    if (isLoading) return;
    const root = document.documentElement;
    if (interfaceSettings?.cursorPointer) {
      root.classList.add(CURSOR_POINTER_CLASS);
    } else {
      root.classList.remove(CURSOR_POINTER_CLASS);
    }
  }, [interfaceSettings?.cursorPointer, isLoading]);

  return <>{children}</>;
}
