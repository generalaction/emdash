import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { KeyboardSettings, ShortcutModifier } from '../types/shortcuts';
import { APP_SHORTCUTS, type ShortcutSettingsKey } from '../hooks/useKeyboardShortcuts';

interface KeyboardSettingsContextValue {
  settings: KeyboardSettings | null;
  getShortcut: (settingsKey: ShortcutSettingsKey) => { key: string; modifier?: ShortcutModifier };
  refreshSettings: () => Promise<void>;
}

const KeyboardSettingsContext = createContext<KeyboardSettingsContextValue | null>(null);

export const KeyboardSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<KeyboardSettings | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const result = await window.electronAPI.getSettings();
      if (result.success && result.settings?.keyboard) {
        setSettings(result.settings.keyboard);
      }
    } catch {
      // Use defaults on error
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const getShortcut = useCallback(
    (settingsKey: ShortcutSettingsKey): { key: string; modifier?: ShortcutModifier } => {
      // Check custom settings first
      const custom = settings?.[settingsKey];
      if (custom) {
        return { key: custom.key, modifier: custom.modifier };
      }
      // Fall back to default from APP_SHORTCUTS
      const defaultShortcut = Object.values(APP_SHORTCUTS).find(
        (s) => s.settingsKey === settingsKey
      );
      if (defaultShortcut) {
        return { key: defaultShortcut.key, modifier: defaultShortcut.modifier };
      }
      return { key: '', modifier: undefined };
    },
    [settings]
  );

  return (
    <KeyboardSettingsContext.Provider value={{ settings, getShortcut, refreshSettings: loadSettings }}>
      {children}
    </KeyboardSettingsContext.Provider>
  );
};

export const useKeyboardSettings = (): KeyboardSettingsContextValue => {
  const context = useContext(KeyboardSettingsContext);
  if (!context) {
    // Return a fallback that uses defaults when not in provider
    return {
      settings: null,
      getShortcut: (settingsKey: ShortcutSettingsKey) => {
        const defaultShortcut = Object.values(APP_SHORTCUTS).find(
          (s) => s.settingsKey === settingsKey
        );
        if (defaultShortcut) {
          return { key: defaultShortcut.key, modifier: defaultShortcut.modifier };
        }
        return { key: '', modifier: undefined };
      },
      refreshSettings: async () => {},
    };
  }
  return context;
};
