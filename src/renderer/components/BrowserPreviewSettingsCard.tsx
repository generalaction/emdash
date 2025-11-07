import React from 'react';
import { Globe } from 'lucide-react';
import chromeLogo from '../../assets/images/chrome.png';
import safariLogo from '../../assets/images/safari.png';
import firefoxLogo from '../../assets/images/firefox.png';
import atlasLogo from '../../assets/images/atlas.png';
import chromiumLogo from '../../assets/images/chromium.png';

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

  const Badge: React.FC<{
    label: string;
    iconSrc?: string;
    fallback?: React.ReactNode;
    active?: boolean;
    disabled?: boolean;
  }> = ({ label, iconSrc, fallback, active, disabled }) => {
    const [broken, setBroken] = React.useState(false);
    const base = 'inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs';
    const style = active
      ? 'border border-primary/40 bg-primary/10 text-primary'
      : 'border border-border/60 bg-muted/20 text-muted-foreground opacity-70';
    return (
      <span className={`${base} ${style}`} aria-disabled={disabled}>
        {iconSrc && !broken ? (
          <img
            src={iconSrc}
            alt=""
            className="h-3.5 w-3.5 rounded-sm"
            onError={() => setBroken(true)}
          />
        ) : (
          fallback || null
        )}
        <span>{label}</span>
      </span>
    );
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
      <div className="mb-2 text-sm text-muted-foreground">
        Preview your workspace UI inside Emdash using the built-in browser view.
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
        <Badge label="Chromium" iconSrc={chromiumLogo} active />
        <Badge label="Safari" iconSrc={safariLogo} disabled />
        <Badge label="Chrome" iconSrc={chromeLogo} disabled />
        <Badge label="Firefox" iconSrc={firefoxLogo} disabled />
        <Badge label="ChatGPT Atlas" iconSrc={atlasLogo} disabled />
      </div>
    </div>
  );
}
