import React, { useCallback, useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';

type Props = {
  value?: boolean;
  defaultValue?: boolean;
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
              'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs text-foreground ' +
              (active
                ? 'border-blue-500/50 bg-blue-500/10 hover:bg-blue-500/15'
                : 'border-border bg-muted dark:border-border dark:bg-muted') +
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
