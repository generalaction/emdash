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
          'inline-flex shrink-0 items-center gap-1 text-muted-foreground in-data-[slot=tooltip-content]:text-background',
        className
      )}
    >
      {keys.map((key, index) =>
        variant === 'keycaps' ? (
          <Kbd
            key={`${key}-${index}`}
            aria-hidden="true"
            className="h-6 min-w-6 shrink-0 rounded-md border border-border/70 bg-background-secondary px-1.5 leading-none text-current shadow-[inset_0_-1px_0_rgba(255,255,255,0.04)] in-data-[slot=tooltip-content]:border-background/20"
          >
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
