import { Megaphone, RotateCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { appState } from '@renderer/lib/stores/app-state';
import { Button } from '@renderer/lib/ui/button';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

export const AnnouncementDevControls = observer(
  function AnnouncementDevControls(): React.JSX.Element | null {
    if (!import.meta.env.DEV) return null;

    const store = appState.featureAnnouncements;

    return (
      <div className="grid gap-3">
        <SettingRow
          title="Show on every launch"
          description="Ignore dismissal and auto-show the announcement after each reload (dev only)."
          className="items-center rounded-lg border p-4"
          control={
            <Switch
              checked={store.devRepeatOnLaunch}
              onCheckedChange={(checked) => store.setDevRepeatOnLaunch(checked)}
              aria-label="Show announcement on every launch"
            />
          }
        />
        <SettingRow
          title="Announcement"
          description="Preview or reset the in-app announcement (dev only)."
          className="items-center rounded-lg border p-4"
          control={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void store.replayPreview('modal');
                }}
              >
                <Megaphone className="size-4" />
                Modal
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void store.replayPreview('toast');
                }}
              >
                <Megaphone className="size-4" />
                Toast
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
      </div>
    );
  }
);
