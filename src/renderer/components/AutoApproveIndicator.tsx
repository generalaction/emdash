import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';

type Props = {
  enabled: boolean;
  className?: string;
};

const AutoApproveIndicator: React.FC<Props> = ({ enabled, className = '' }) => {
  if (!enabled) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={
              'inline-flex h-7 items-center gap-1.5 rounded-md border border-orange-500/60 bg-orange-500/10 px-2 text-xs text-foreground ring-1 ring-inset ring-orange-500/25' +
              (className ? ' ' + className : '')
            }
          >
            <ShieldCheck
              className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400"
              aria-hidden="true"
            />
            <span className="font-medium">Auto-approve</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line text-xs leading-snug">
          <div>
            <span className="block font-medium">Auto-approve Enabled</span>
            <span className="block">
              File operations are automatically approved without prompting. This task was created
              with --dangerously-skip-permissions mode.
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default AutoApproveIndicator;
