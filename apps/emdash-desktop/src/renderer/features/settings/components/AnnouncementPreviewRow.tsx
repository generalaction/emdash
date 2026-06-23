import { Megaphone } from 'lucide-react';
import React from 'react';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { SettingRow } from './SettingRow';

export function AnnouncementPreviewRow(): React.JSX.Element | null {
  if (!import.meta.env.DEV) return null;

  return (
    <SettingRow
      title="Announcement"
      description="Preview the newest in-app announcement (dev only)."
      className="items-center rounded-lg border p-4"
      control={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void appState.featureAnnouncements.refresh({ preview: true });
          }}
        >
          <Megaphone className="size-4" />
          Preview
        </Button>
      }
    />
  );
}
