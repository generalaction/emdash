import type { VariantProps } from 'class-variance-authority';
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';
import { Button, buttonVariants } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
}: SplitButtonProps) {
  const [selectedValue, setSelectedValue] = useState(defaultValue ?? actions[0]?.value);

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
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant={variant}
              size={size}
              className={cn('rounded-l-none border-l border-current/20', px)}
              disabled={isDisabled}
            />
          }
        >
          <ChevronDown className={iconSize} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={cn('w-64', dropdownContentClassName)}>
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.value}
              onClick={() => setSelectedValue(action.value)}
              className="flex-col items-start gap-0.5 py-2"
            >
              <span className="font-medium">{action.label}</span>
              {action.description && (
                <span className="text-xs text-muted-foreground whitespace-normal">
                  {action.description}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
