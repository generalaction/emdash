import React, { useCallback, useEffect, useState } from 'react';
import { Input } from './ui/input';

type TerminalSettings = {
  fontFamily: string;
};

const DEFAULTS: TerminalSettings = {
  fontFamily: '',
};

const TerminalSettingsCard: React.FC = () => {
  const [settings, setSettings] = useState<TerminalSettings>(DEFAULTS);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  const load = useCallback(async () => {
    try {
      const res = await window.electronAPI.getSettings();
      if (res?.success && res.settings?.terminal) {
        const terminal = res.settings.terminal;
        setSettings({
          fontFamily: terminal.fontFamily ?? DEFAULTS.fontFamily,
        });
      } else {
        setSettings(DEFAULTS);
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
          setSettings({
            fontFamily: terminal.fontFamily ?? DEFAULTS.fontFamily,
          });
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

  return (
    <div className="grid gap-1">
      <Input
        value={settings.fontFamily}
        onChange={(e) => setSettings((s) => ({ ...s, fontFamily: e.target.value }))}
        onBlur={() => savePartial({ fontFamily: settings.fontFamily.trim() })}
        placeholder="e.g. MesloLGS NF"
        aria-label="Terminal font family"
        disabled={loading || saving}
      />
      <div className="text-[11px] text-muted-foreground">
        Use a custom terminal font from your device.
      </div>
    </div>
  );
};

export default TerminalSettingsCard;
