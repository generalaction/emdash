import { useEffect } from 'react';
import { menuOpenSettingsChannel } from '@shared/events/appEvents';
import { events } from '@renderer/lib/ipc';
import { useNavigate, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { toggleSettingsView } from '@renderer/lib/layout/settings-toggle';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();

  useEffect(() => {
    return events.on(menuOpenSettingsChannel, () => {
      const shouldOpen = onOpenSettings?.() ?? true;
      if (shouldOpen === false) return;

      toggleSettingsView(navigate, currentView);
    });
  }, [navigate, onOpenSettings, currentView]);

  return null;
}
