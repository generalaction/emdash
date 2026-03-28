import type { Button as ButtonPrimitive } from '@base-ui/react/button';
import { useHotkey } from '@tanstack/react-hotkeys';
import type { VariantProps } from 'class-variance-authority';
import { useRef } from 'react';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { getEffectiveHotkey } from '@renderer/hooks/useKeyboardShortcuts';
import { Button, buttonVariants } from './button';
import { ShortcutHint } from './shortcut-hint';

type ConfirmButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

export function ConfirmButton({ disabled, children, ...props }: ConfirmButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { value: keyboard } = useAppSettingsKey('keyboard');

  useHotkey(getEffectiveHotkey('confirm', keyboard), () => ref.current?.click(), {
    enabled: !disabled,
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
