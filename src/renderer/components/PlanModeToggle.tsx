import React, { useCallback, useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';

type Props = {
  value?: boolean; // controlled state
  defaultValue?: boolean; // uncontrolled initial state
  onChange?: (next: boolean) => void;
  className?: string;
  label?: string;
};

const PlanModeToggle: React.FC<Props> = ({
  value,
  defaultValue = false,
  onChange,
  className = '',
  label = 'Plan Mode',
}) => {
  const isControlled = useMemo(() => typeof value === 'boolean', [value]);
  const [internal, setInternal] = useState<boolean>(defaultValue);
  const active = isControlled ? (value as boolean) : internal;

  const toggle = useCallback(() => {
    const next = !active;
    if (!isControlled) setInternal(next);
    try {
      onChange?.(next);
    } catch {}
  }, [active, isControlled, onChange]);

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-pressed={active}
            onClick={toggle}
            title={label}
            className={
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-offset-0 ' +
              (active
                ? 'border border-accent/60 bg-accent/10 text-foreground ring-1 ring-inset ring-accent/25 hover:bg-accent/15 focus-visible:ring-accent/40'
                : 'border border-gray-200 bg-gray-100 text-foreground hover:bg-gray-200 dark:border-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600') +
              (className ? ' ' + className : '')
            }
          >
            <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-medium">{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line text-xs leading-snug">
          {active ? (
            <span className="font-medium">Plan Mode Enabled</span>
          ) : (
            <div>
              <span className="block font-medium">Plan Mode Disabled</span>
              <span className="block">
                Plan Mode disables all editing and execution capabilities and supports you in
                mapping out a plan for implementing the changes.
              </span>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default PlanModeToggle;
