import { Button, type ButtonProps } from '@emdash/ui/react/primitives';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './dropdown-menu';

export interface SplitButtonAction {
  value: string;
  label: string;
  description?: string;
  action: () => void;
}

type SplitButtonSize = 'xs' | 'sm' | 'default';

/** Legacy variant vocabulary kept for existing callers until the W11 port. */
type SplitButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';

function mapVariant(variant: SplitButtonVariant): ButtonProps['variant'] {
  switch (variant) {
    case 'default':
      return 'primary';
    case 'outline':
      return 'secondary';
    default:
      return variant;
  }
}

interface SplitButtonProps {
  actions: SplitButtonAction[];
  defaultValue?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  icon?: ReactNode;
  variant?: SplitButtonVariant;
  size?: SplitButtonSize;
  className?: string;
  dropdownContentClassName?: string;
  onValueChange?: (value: string) => void;
}

const chevronConfig: Record<SplitButtonSize, { px: string; iconSize: string }> = {
  xs: { px: 'px-1', iconSize: 'size-3' },
  sm: { px: 'px-1.5', iconSize: 'size-3.5' },
  default: { px: 'px-2', iconSize: 'size-4' },
};

export function SplitButton({
  actions,
  defaultValue,
  disabled,
  loading,
  loadingLabel,
  icon,
  variant = 'default',
  size = 'default',
  className,
  dropdownContentClassName,
  onValueChange,
}: SplitButtonProps) {
  const [selectedValue, setSelectedValue] = useState(defaultValue ?? actions[0]?.value);
  const [open, setOpen] = useState(false);

  const selectedAction = actions.find((a) => a.value === selectedValue) ?? actions[0];
  if (!selectedAction) return null;

  const { px, iconSize } = chevronConfig[size];
  const isDisabled = disabled || loading;
  const mappedVariant = mapVariant(variant);
  const mappedSize: ButtonProps['size'] = size === 'default' ? 'base' : size;

  return (
    <div className={cn('flex items-center', className)}>
      <Button
        variant={mappedVariant}
        size={mappedSize}
        className="min-w-0 flex-1 shrink rounded-r-none"
        onClick={selectedAction.action}
        disabled={isDisabled}
      >
        {icon}
        {loading ? (loadingLabel ?? 'Loading...') : selectedAction.label}
      </Button>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant={mappedVariant}
              size={mappedSize}
              className={cn('rounded-l-none border-l', px)}
              disabled={isDisabled}
            />
          }
        >
          <ChevronDown className={iconSize} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={cn('w-64', dropdownContentClassName)}>
          <DropdownMenuRadioGroup
            value={selectedValue}
            onValueChange={(value) => {
              if (value) {
                setSelectedValue(value);
                onValueChange?.(value);
                setTimeout(() => {
                  setOpen(false);
                }, 50);
              }
            }}
          >
            {actions.map((action) => (
              <DropdownMenuRadioItem
                key={action.value}
                value={action.value}
                className="flex-col items-start gap-1 py-2"
              >
                <span className="text-sm">{action.label}</span>
                {action.description && (
                  <span className="text-xs whitespace-normal text-foreground-muted">
                    {action.description}
                  </span>
                )}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
