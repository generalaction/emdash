import { formatForDisplay } from '@tanstack/react-hotkeys';
import React from 'react';
import { useAppSettingsKey } from '@renderer/core/settings/use-app-settings-key';
import { getEffectiveHotkey, type ShortcutSettingsKey } from '../../hooks/useKeyboardShortcuts';
import { Kbd, KbdGroup } from './kbd';

interface ShortcutHintProps {
  settingsKey: ShortcutSettingsKey;
  className?: string;
}

export const ShortcutHint: React.FC<ShortcutHintProps> = ({ settingsKey, className }) => {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const hotkey = getEffectiveHotkey(settingsKey, keyboard);
  const display = formatForDisplay(hotkey);

  if (!display) return null;

  return (
    <span className={`flex items-center gap-1 text-xs text-muted-foreground ${className ?? ''}`}>
      <KbdGroup>
        {display.split('+').map((key, _) => (
          <Kbd key={key}>{key.trim()}</Kbd>
        ))}
      </KbdGroup>
    </span>
  );
};

export default ShortcutHint;
