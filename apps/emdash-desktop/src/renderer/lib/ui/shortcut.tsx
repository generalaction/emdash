import { Kbd, KbdGroup } from '@emdash/ui';
import { detectPlatform, parseHotkey, type Hotkey } from '@tanstack/react-hotkeys';
import { useMemo } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  getEffectiveHotkey,
  type ShortcutSettingsKey,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { cn } from '@renderer/utils/utils';
import {
  describeShortcut,
  formatShortcutDisplay,
  formatShortcutKey,
  getShortcutKeyOpticalAlignClass,
  getShortcutKeys,
} from './shortcut-format';

const PLATFORM = detectPlatform();

type ShortcutVariant = 'text' | 'badge' | 'keycaps';

const KEYCAP_KBD_BASE_CLASS = 'shrink-0 rounded text-current';

const KEYCAP_KBD_CLASS = cn(
  KEYCAP_KBD_BASE_CLASS,
  'bg-background-3',
  // Sidebar menu rows use the same token as background-3 on light-mode hover.
  'in-data-[slot=button]:group-hover:bg-background-tertiary-2 dark:in-data-[slot=button]:group-hover:bg-background-3',
  // Primary action buttons (Create, Save, etc.).
  'in-data-[variant=default]:bg-primary-button-foreground/16 in-data-[variant=default]:group-hover:bg-primary-button-foreground/16',
  'in-data-[slot=combobox-trigger]:bg-background-3',
  'in-data-[slot=tooltip-content]:bg-background/15 in-data-[slot=tooltip-content]:text-background',
  'in-data-[slot=dropdown-menu-item]:bg-background-3'
);

const SHORT_KEYCAP_KBD_CLASS = 'w-5 px-0';

interface ShortcutProps {
  hotkey: Hotkey | null | undefined;
  className?: string;
  variant?: ShortcutVariant;
}

/** Display a shortcut when the hotkey string is already resolved. */
function Shortcut({ hotkey, className, variant = 'text' }: ShortcutProps) {
  const parsed = useMemo(() => {
    if (!hotkey) return null;
    return parseHotkey(hotkey, PLATFORM);
  }, [hotkey]);

  if (!parsed) return null;

  const keys = getShortcutKeys(parsed, PLATFORM);

  return (
    <span
      data-slot="shortcut"
      role="img"
      aria-label={describeShortcut(parsed, PLATFORM)}
      className={cn(
        variant === 'text' &&
          'inline-block shrink-0 whitespace-nowrap rounded px-1.5 py-1 text-xs leading-none text-muted-foreground in-data-[slot=tooltip-content]:text-background',
        variant === 'badge' &&
          'inline-flex shrink-0 items-center justify-center gap-0 rounded bg-background-secondary px-1.5 py-1 text-xs leading-none text-foreground/60 in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:py-0.5 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10',
        variant === 'keycaps' &&
          'shrink-0 text-muted-foreground in-data-[slot=button]:text-current in-data-[slot=combobox-trigger]:text-current in-data-[slot=tooltip-content]:text-background',
        className
      )}
    >
      {variant === 'keycaps' ? (
        <KbdGroup className="items-center justify-center gap-0.5">
          {keys.map((key, index) => {
            const label = formatShortcutKey(key, PLATFORM);

            return (
              <Kbd
                key={`${key}-${index}`}
                aria-hidden="true"
                className={cn(
                  KEYCAP_KBD_CLASS,
                  label.length === 1 && SHORT_KEYCAP_KBD_CLASS
                )}
              >
                {label}
              </Kbd>
            );
          })}
        </KbdGroup>
      ) : variant === 'text' ? (
        <span aria-hidden="true">{formatShortcutDisplay(keys, PLATFORM)}</span>
      ) : (
        keys.map((key, index) => (
          <span
            key={`${key}-${index}`}
            aria-hidden="true"
            className={cn('inline-block', getShortcutKeyOpticalAlignClass(key))}
          >
            {formatShortcutKey(key, PLATFORM)}
          </span>
        ))
      )}
    </span>
  );
}

interface BoundShortcutProps {
  settingsKey: ShortcutSettingsKey;
  className?: string;
  variant?: ShortcutVariant;
}

/** Display a shortcut directly from an app shortcut settings key. */
function BoundShortcut({ settingsKey, className, variant }: BoundShortcutProps) {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const hotkey = getEffectiveHotkey(settingsKey, keyboard);

  return <Shortcut hotkey={hotkey} className={className} variant={variant} />;
}

export { BoundShortcut, Shortcut, type ShortcutVariant };
