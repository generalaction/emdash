import { Megaphone, RotateCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { SettingRow } from './SettingRow';

export const AnnouncementDevControls = observer(
  function AnnouncementDevControls(): React.JSX.Element | null {
    if (!import.meta.env.DEV) return null;

    const store = appState.featureAnnouncements;

    return (
      <SettingRow
        title="Announcement"
        description="Preview or reset the in-app announcement sidebar card (dev only)."
        className="items-center rounded-lg border p-4"
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void store.replayPreview();
              }}
            >
              <Megaphone className="size-4" />
              Show
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                void store.clearDismissal();
              }}
              disabled={!store.manifest}
            >
              <RotateCcw className="size-4" />
              Reset
            </Button>
          </div>
        }
      />
    );
  }
);
