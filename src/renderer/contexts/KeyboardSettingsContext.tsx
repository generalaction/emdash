import React, { createContext, useCallback, useContext } from 'react';
import type { KeyboardSettings, ShortcutModifier } from '../types/shortcuts';
import { APP_SHORTCUTS, type ShortcutSettingsKey } from '../hooks/useKeyboardShortcuts';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { useQueryClient } from '@tanstack/react-query';

interface KeyboardSettingsContextValue {
  settings: KeyboardSettings | null;
  getShortcut: (settingsKey: ShortcutSettingsKey) => { key: string; modifier?: ShortcutModifier };
  refreshSettings: () => Promise<void>;
}

const KeyboardSettingsContext = createContext<KeyboardSettingsContextValue | null>(null);

export const KeyboardSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings: appSettings } = useAppSettings();
  const queryClient = useQueryClient();

  const settings: KeyboardSettings | null = appSettings?.keyboard ?? null;

  const refreshSettings = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['appSettings'] });
  }, [queryClient]);

  const getShortcut = useCallback(
    (settingsKey: ShortcutSettingsKey): { key: string; modifier?: ShortcutModifier } => {
      const custom = settings?.[settingsKey];
      if (custom) {
        return { key: custom.key, modifier: custom.modifier };
      }
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
    <KeyboardSettingsContext.Provider value={{ settings, getShortcut, refreshSettings }}>
      {children}
    </KeyboardSettingsContext.Provider>
  );
};

export const useKeyboardSettings = (): KeyboardSettingsContextValue => {
  const context = useContext(KeyboardSettingsContext);
  if (!context) {
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
