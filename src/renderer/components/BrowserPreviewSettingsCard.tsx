import React from 'react';

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
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="mb-2 text-sm text-muted-foreground">
        Preview your workspace UI inside Emdash using the embedded Chromium engine.
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={enabled}
          disabled={loading}
          onChange={(e) => update(e.target.checked)}
        />
        Enable in‑app browser preview
      </label>
      <div className="mt-3 text-xs text-muted-foreground">Engine</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
          Chromium (current)
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/20 px-2 py-0.5 text-xs text-muted-foreground opacity-70">
          Safari (coming soon)
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/20 px-2 py-0.5 text-xs text-muted-foreground opacity-70">
          Chrome (coming soon)
        </span>
        <span className="inline-flex items-center gap-1 rounded border border-border/60 bg-muted/20 px-2 py-0.5 text-xs text-muted-foreground opacity-70">
          Firefox (coming soon)
        </span>
      </div>
    </div>
  );
}

