import {
  detectPlatform,
  KEY_DISPLAY_SYMBOLS,
  MAC_MODIFIER_SYMBOLS,
  parseHotkey,
  STANDARD_MODIFIER_LABELS,
} from '@tanstack/react-hotkeys';
import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  getEffectiveHotkey,
  type ShortcutSettingsKey,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { cn } from '@renderer/utils/utils';
import { Kbd, KbdGroup } from './kbd';

interface ShortcutHintProps {
  settingsKey: ShortcutSettingsKey;
  className?: string;
}

const PLATFORM = detectPlatform();
const IS_MAC = PLATFORM === 'mac';

export const ShortcutHint: React.FC<ShortcutHintProps> = ({ settingsKey, className }) => {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const hotkey = getEffectiveHotkey(settingsKey, keyboard);

  if (!hotkey) return null;

  const parsed = parseHotkey(hotkey, PLATFORM);

  return (
    <span className={cn('flex items-center gap-1 text-xs text-muted-foreground', className)}>
      <KbdGroup>
        {parsed.modifiers.map((modifier, idx) => {
          const glyph = IS_MAC
            ? MAC_MODIFIER_SYMBOLS[modifier]
            : STANDARD_MODIFIER_LABELS[modifier];
          return (
            <Kbd key={idx}>{IS_MAC ? <span className="translate-y-px">{glyph}</span> : glyph}</Kbd>
          );
        })}
        <Kbd>{KEY_DISPLAY_SYMBOLS[parsed.key] ?? parsed.key}</Kbd>
      </KbdGroup>
    </span>
  );
};
