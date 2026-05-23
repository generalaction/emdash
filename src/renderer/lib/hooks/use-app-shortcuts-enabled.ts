import { useObserver } from 'mobx-react-lite';
import { modalStore } from '@renderer/lib/modal/modal-store';

export function useAppShortcutsEnabled() {
  return useObserver(() => !modalStore.isOpen);
}
