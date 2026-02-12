import React from 'react';
import { Switch } from './ui/switch';

export default function BrowserPreviewSettingsCard() {
  const [enabled, setEnabled] = React.useState(true);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const s = await (window as any).electronAPI?.getSettings?.();
        const en = Boolean(s?.browserPreview?.enabled ?? true);
        setEnabled(en);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const update = async (next: boolean) => {
    setEnabled(next);
    try {
      await (window as any).electronAPI?.updateSettings?.({ browserPreview: { enabled: next } });
    } catch {}
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">Show localhost links in browser</span>
        <span className="text-sm text-muted-foreground">
          Preview UI changes using the built-in browser view.
        </span>
      </div>
      <Switch
        checked={enabled}
        disabled={loading}
        onCheckedChange={(checked) => update(checked === true)}
      />
    </div>
  );
}
