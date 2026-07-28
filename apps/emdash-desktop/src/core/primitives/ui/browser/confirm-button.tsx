import type { Button as ButtonPrimitive } from '@base-ui/react/button';
import { Button, type ButtonProps } from '@emdash/ui/react/primitives';
import type { VariantProps } from 'class-variance-authority';
import { useRef } from 'react';
import { useConfirm } from '@core/primitives/keybindings/browser';
import type { buttonVariants } from './button';
import { BoundShortcut } from './shortcut';

type ConfirmButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

function mapVariant(variant: ConfirmButtonProps['variant']): ButtonProps['variant'] {
  switch (variant) {
    case 'default':
      return 'primary';
    case 'outline':
    case 'secondary':
      return 'secondary';
    case 'ghost':
    case 'link':
      return variant;
    case 'destructive':
      return 'destructive';
    default:
      return 'primary';
  }
}

function mapSize(size: ConfirmButtonProps['size']): ButtonProps['size'] {
  switch (size) {
    case 'default':
    case 'lg':
      return 'base';
    case 'xs':
    case 'sm':
      return 'sm';
    default:
      return 'base';
  }
}

function isIconSize(size: ConfirmButtonProps['size']): boolean {
  return typeof size === 'string' && size.startsWith('icon');
}

export function ConfirmButton({ disabled, children, variant, size, ...props }: ConfirmButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useConfirm(() => ref.current?.click(), {
    enabled: !disabled,
  });

  const mappedVariant = mapVariant(variant);
  const mappedSize = isIconSize(size) ? 'base' : mapSize(size);

  return (
    <Button
      ref={ref}
      disabled={disabled}
      variant={mappedVariant}
      size={mappedSize}
      icon={isIconSize(size)}
      {...props}
    >
      <span className="flex items-center gap-2">
        {children}
        <BoundShortcut command="app.confirm" variant="keycaps" />
      </span>
    </Button>
  );
}
