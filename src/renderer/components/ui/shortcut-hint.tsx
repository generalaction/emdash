import { formatForDisplay } from '@tanstack/react-hotkeys';
import React from 'react';
import { useAppSettingsKey } from '@renderer/core/app/AppSettingsProvider';
import { getEffectiveHotkey, type ShortcutSettingsKey } from '../../hooks/useKeyboardShortcuts';

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
    <span className={`flex items-center gap-1 text-muted-foreground ${className ?? ''}`}>
      {display}
    </span>
  );
};

export default ShortcutHint;
