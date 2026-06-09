import { useEffect } from 'react';
import { useModalContext } from '@renderer/lib/modal/modal-provider';

/**
 * Activates a close guard on the currently open modal while `isActive` is true,
 * preventing it from being dismissed via escape key or clicking outside.
 * Does not block explicit close button clicks.
 */
export function useCloseGuard(isActive: boolean) {
  const { setCloseGuard } = useModalContext();

  useEffect(() => {
    setCloseGuard(isActive);
    return () => {
      if (isActive) setCloseGuard(false);
    };
  }, [isActive, setCloseGuard]);
}
