import type { Button as ButtonPrimitive } from '@base-ui/react/button';
import type { VariantProps } from 'class-variance-authority';
import { useRef } from 'react';
import { useConfirm } from '@core/primitives/keybindings/browser';
import { Button, type buttonVariants } from './button';
import { BoundShortcut } from './shortcut';

type ConfirmButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

export function ConfirmButton({ disabled, children, ...props }: ConfirmButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useConfirm(() => ref.current?.click(), {
    enabled: !disabled,
  });

  return (
    <Button ref={ref} disabled={disabled} {...props}>
      <span className="flex items-center gap-2">
        {children}
        <BoundShortcut command="app.confirm" variant="keycaps" />
      </span>
    </Button>
  );
}
