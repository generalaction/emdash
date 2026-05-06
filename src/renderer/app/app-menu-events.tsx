import { useEffect } from 'react';
import { menuOpenSettingsChannel } from '@shared/events/appEvents';
import { events } from '@renderer/lib/ipc';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { navigate } = useNavigate();

  useEffect(() => {
    return events.on(menuOpenSettingsChannel, () => {
      const shouldOpen = onOpenSettings?.() ?? true;
      if (shouldOpen === false) return;

      navigate('settings');
    });
  }, [navigate, onOpenSettings]);

  return null;
}
