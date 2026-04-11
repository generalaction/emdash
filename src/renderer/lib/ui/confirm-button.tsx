import type { Button as ButtonPrimitive } from '@base-ui/react/button';
import { useHotkey } from '@tanstack/react-hotkeys';
import type { VariantProps } from 'class-variance-authority';
import { useRef } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { Button, buttonVariants } from './button';
import { ShortcutHint } from './shortcut-hint';

type ConfirmButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

export function ConfirmButton({ disabled, children, ...props }: ConfirmButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const confirmHotkey = getEffectiveHotkey('confirm', keyboard);

  useHotkey(getHotkeyRegistration('confirm', keyboard), () => ref.current?.click(), {
    enabled: !disabled && confirmHotkey !== null,
  });

  return (
    <Button ref={ref} disabled={disabled} {...props}>
      <span className="flex items-center gap-2">
        {children}
        <ShortcutHint settingsKey="confirm" />
      </span>
    </Button>
  );
}
