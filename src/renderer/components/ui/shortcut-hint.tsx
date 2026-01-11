import React from 'react';
import { Command } from 'lucide-react';
import { useKeyboardSettings } from '../../contexts/KeyboardSettingsContext';
import type { ShortcutSettingsKey } from '../../hooks/useKeyboardShortcuts';
import type { ShortcutModifier } from '../../types/shortcuts';

interface ShortcutHintProps {
  settingsKey: ShortcutSettingsKey;
  className?: string;
}

const ModifierIcon: React.FC<{ modifier: ShortcutModifier }> = ({ modifier }) => {
  switch (modifier) {
    case 'cmd':
      return <Command className="h-3 w-3" aria-hidden="true" />;
    case 'ctrl':
      return <span>Ctrl</span>;
    case 'alt':
    case 'option':
      return <span>⌥</span>;
    case 'shift':
      return <span>⇧</span>;
    default:
      return null;
  }
};

export const ShortcutHint: React.FC<ShortcutHintProps> = ({ settingsKey, className }) => {
  const { getShortcut } = useKeyboardSettings();
  const { key, modifier } = getShortcut(settingsKey);

  if (!key) return null;

  // Format key display (handle arrow keys and special keys)
  let displayKey = key;
  if (displayKey === 'ArrowLeft') displayKey = '←';
  else if (displayKey === 'ArrowRight') displayKey = '→';
  else if (displayKey === 'ArrowUp') displayKey = '↑';
  else if (displayKey === 'ArrowDown') displayKey = '↓';
  else if (displayKey === 'Escape') displayKey = 'Esc';
  else displayKey = displayKey.toUpperCase();

  return (
    <span className={`flex items-center gap-1 text-muted-foreground ${className || ''}`}>
      {modifier && <ModifierIcon modifier={modifier} />}
      <span>{displayKey}</span>
    </span>
  );
};

export default ShortcutHint;
