import { Megaphone, RotateCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { presentFeatureAnnouncement } from '@renderer/features/feature-announcements/present-feature-announcement';
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
        description="Preview or reset the in-app announcement toast (dev only)."
        className="items-center rounded-lg border p-4"
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                await store.replayPreview();
                if (!store.manifest) return;
                store.markPresented();
                presentFeatureAnnouncement(store.manifest, {
                  onDismiss: () => store.resetPresentation(),
                });
              }}
            >
              <Megaphone className="size-4" />
              Show
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => store.clearDismissal()}
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
