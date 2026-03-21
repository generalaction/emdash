import React, { createContext, useCallback, useContext } from 'react';
import type { KeyboardSettings, ShortcutModifier } from '../types/shortcuts';
import { APP_SHORTCUTS, type ShortcutSettingsKey } from '../hooks/useKeyboardShortcuts';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { useQueryClient } from '@tanstack/react-query';

type ResolvedShortcutBinding = { key: string; modifier?: ShortcutModifier };

interface KeyboardSettingsContextValue {
  settings: KeyboardSettings | null;
  getShortcut: (settingsKey: ShortcutSettingsKey) => ResolvedShortcutBinding | null;
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
    (settingsKey: ShortcutSettingsKey): ResolvedShortcutBinding | null => {
      const custom = settings?.[settingsKey];
      if (custom === null) {
        return null;
      }
      if (custom) {
        return { key: custom.key, modifier: custom.modifier };
      }
      const defaultShortcut = Object.values(APP_SHORTCUTS).find(
        (s) => s.settingsKey === settingsKey
      );
      if (defaultShortcut) {
        return { key: defaultShortcut.key, modifier: defaultShortcut.modifier };
      }
      return null;
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
        return null;
      },
      refreshSettings: async () => {},
    };
  }
  return context;
};
