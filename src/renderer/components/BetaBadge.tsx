import React from 'react';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';

interface BetaBadgeProps {
  tooltip?: string;
  className?: string;
}

const DEFAULT_TOOLTIP =
  'Beta: Docker (local) is Node‑first. Only Node projects are supported right now. Custom image/setup and multi‑service (Compose) are coming soon.';

export const BetaBadge: React.FC<BetaBadgeProps> = ({ tooltip = DEFAULT_TOOLTIP, className }) => {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={[
              'inline-flex items-center rounded-md border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5',
              'text-[10px] font-medium text-amber-700 dark:text-amber-400',
              className || '',
            ].join(' ')}
          >
            Beta
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[24rem] text-xs leading-snug">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default BetaBadge;
