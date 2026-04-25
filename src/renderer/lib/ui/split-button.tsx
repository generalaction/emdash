import type { VariantProps } from 'class-variance-authority';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';
import { Button, buttonVariants } from './button';
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

interface SplitButtonProps {
  actions: SplitButtonAction[];
  defaultValue?: string;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  icon?: ReactNode;
  variant?: VariantProps<typeof buttonVariants>['variant'];
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

  return (
    <div className={cn('flex items-center', className)}>
      <Button
        variant={variant}
        size={size}
        className="flex-1 min-w-0 shrink rounded-r-none"
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
              variant={variant}
              size={size}
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
                  <span className="text-xs text-foreground-muted whitespace-normal">
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
