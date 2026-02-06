import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { X } from 'lucide-react';

type TerminalSettings = {
  fontFamily: string;
};

const DEFAULTS: TerminalSettings = {
  fontFamily: '',
};

const POPULAR_FONTS = [
  'Menlo',
  'SF Mono',
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Iosevka',
  'Source Code Pro',
  'MesloLGS NF',
];

const TerminalSettingsCard: React.FC = () => {
  const [settings, setSettings] = useState<TerminalSettings>(DEFAULTS);
  const [customFont, setCustomFont] = useState<string>('');
  const [showSelectedPill, setShowSelectedPill] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const customInputRef = useRef<HTMLInputElement | null>(null);

  const isPopularFont = useCallback(
    (font: string) => POPULAR_FONTS.some((option) => option.toLowerCase() === font.trim().toLowerCase()),
    []
  );

  const load = useCallback(async () => {
    try {
      const res = await window.electronAPI.getSettings();
      if (res?.success && res.settings?.terminal) {
        const terminal = res.settings.terminal;
        const fontFamily = terminal.fontFamily ?? DEFAULTS.fontFamily;
        setSettings({
          fontFamily,
        });
        setCustomFont(isPopularFont(fontFamily) ? '' : fontFamily);
        setShowSelectedPill(true);
      } else {
        setSettings(DEFAULTS);
        setCustomFont('');
        setShowSelectedPill(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePartial = useCallback(
    async (partial: Partial<TerminalSettings>) => {
      setSaving(true);
      try {
        const next = { ...settings, ...partial };
        const res = await window.electronAPI.updateSettings({ terminal: next });
        if (res?.success && res.settings?.terminal) {
          const terminal = res.settings.terminal;
          const fontFamily = terminal.fontFamily ?? DEFAULTS.fontFamily;
          setSettings({
            fontFamily,
          });
          setCustomFont(isPopularFont(fontFamily) ? '' : fontFamily);
          setShowSelectedPill(true);
          window.dispatchEvent(
            new CustomEvent('terminal-font-changed', {
              detail: { fontFamily: terminal.fontFamily },
            })
          );
        }
      } finally {
        setSaving(false);
      }
    },
    [settings]
  );

  const applyFont = useCallback(
    async (fontFamily: string) => {
      const normalized = fontFamily.trim();
      setSettings((s) => ({ ...s, fontFamily: normalized }));
      setCustomFont(isPopularFont(normalized) ? '' : normalized);
      setShowSelectedPill(true);
      await savePartial({ fontFamily: normalized });
    },
    [isPopularFont, savePartial]
  );
  const selectedFont = settings.fontFamily.trim().toLowerCase();
  const selectedLabel = (() => {
    if (!settings.fontFamily.trim()) return 'Default';
    const popular = POPULAR_FONTS.find((font) => font.toLowerCase() === selectedFont);
    return popular ?? settings.fontFamily.trim();
  })();

  return (
    <div className="grid gap-2">
      <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm">
        {!customFont.trim() && showSelectedPill && (
          <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 text-xs font-medium text-foreground whitespace-nowrap">
            <span>{selectedLabel}</span>
            <button
              type="button"
              aria-label="Edit custom font"
              className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => {
                setShowSelectedPill(false);
                requestAnimationFrame(() => customInputRef.current?.focus());
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <input
          ref={customInputRef}
          value={customFont}
          onChange={(e) => setCustomFont(e.target.value)}
          onBlur={() => {
            void applyFont(customFont);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          placeholder={customFont.trim() || showSelectedPill ? '' : 'Type custom font name'}
          aria-label="Custom terminal font family"
          disabled={loading || saving}
          className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={!selectedFont ? 'secondary' : 'outline'}
          className="h-7 text-xs"
          disabled={loading || saving}
          onClick={() => {
            void applyFont('');
          }}
        >
          Default
        </Button>
        {POPULAR_FONTS.map((font) => (
          <Button
            key={font}
            type="button"
            size="sm"
            variant={selectedFont === font.toLowerCase() ? 'secondary' : 'outline'}
            className="h-7 text-xs"
            disabled={loading || saving}
            onClick={() => {
              void applyFont(font);
            }}
          >
            {font}
          </Button>
        ))}
      </div>
      <div className="text-[11px] text-muted-foreground">
        Pick one of the popular fonts, or type a custom font name.
      </div>
    </div>
  );
};

export default TerminalSettingsCard;
