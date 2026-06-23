import { detectPlatform, parseHotkey, type Hotkey } from '@tanstack/react-hotkeys';
import { useMemo } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  getEffectiveHotkey,
  type ShortcutSettingsKey,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { cn } from '@renderer/utils/utils';
import { Kbd } from './kbd';
import {
  describeShortcut,
  formatShortcutKey,
  getShortcutKeyOpticalAlignClass,
  getShortcutKeys,
} from './shortcut-format';

const PLATFORM = detectPlatform();

type ShortcutVariant = 'text' | 'badge' | 'keycaps';

const KEYCAP_KBD_BASE_CLASS =
  'h-5 min-w-5 shrink-0 rounded px-1 text-[11px] font-medium leading-none text-current';

const KEYCAP_KBD_CLASS = cn(
  KEYCAP_KBD_BASE_CLASS,
  'border border-border/60 bg-background-secondary shadow-[inset_0_-1px_0_rgba(255,255,255,0.05)]',
  // Primary action buttons (Create, Save, etc.).
  'in-data-[variant=default]:border-primary-button-foreground/22 in-data-[variant=default]:bg-primary-button-foreground/16 in-data-[variant=default]:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]',
  'in-data-[slot=combobox-trigger]:border-border/50 in-data-[slot=combobox-trigger]:bg-background-secondary in-data-[slot=combobox-trigger]:shadow-[inset_0_-1px_0_rgba(255,255,255,0.05)]',
  'in-data-[slot=tooltip-content]:border-background/20 in-data-[slot=tooltip-content]:bg-background/15 in-data-[slot=tooltip-content]:text-background in-data-[slot=tooltip-content]:shadow-none',
  'in-data-[slot=dropdown-menu-item]:border-border/50 in-data-[slot=dropdown-menu-item]:bg-background-secondary in-data-[slot=dropdown-menu-item]:shadow-[inset_0_-1px_0_rgba(255,255,255,0.05)]'
);

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
          'inline-flex shrink-0 items-center justify-center gap-0 rounded px-1.5 py-1 text-xs leading-none text-muted-foreground in-data-[slot=tooltip-content]:text-background',
        variant === 'badge' &&
          'inline-flex shrink-0 items-center justify-center gap-0 rounded bg-background-secondary px-1.5 py-1 text-xs leading-none text-foreground/60 in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:py-0.5 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10',
        variant === 'keycaps' &&
          'inline-flex shrink-0 items-center gap-0.5 text-muted-foreground in-data-[slot=button]:text-current in-data-[slot=combobox-trigger]:text-current in-data-[slot=tooltip-content]:text-background',
        className
      )}
    >
      {keys.map((key, index) =>
        variant === 'keycaps' ? (
          <Kbd key={`${key}-${index}`} aria-hidden="true" className={KEYCAP_KBD_CLASS}>
            <span className={cn('inline-block', getShortcutKeyOpticalAlignClass(key))}>
              {formatShortcutKey(key, PLATFORM)}
            </span>
          </Kbd>
        ) : (
          <span
            key={`${key}-${index}`}
            aria-hidden="true"
            className={cn('inline-block', getShortcutKeyOpticalAlignClass(key))}
          >
            {formatShortcutKey(key, PLATFORM)}
          </span>
        )
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
