import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function DedupBadge() {
  return (
    <Tooltip>
      <TooltipTrigger>
        <span className="inline-flex items-center gap-1 rounded bg-background-2 px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-foreground/50 uppercase">
          deduplicated
          <Info className="h-3 w-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Each API response is counted once. When you resume or fork a session, the earlier messages
        get copied into the new transcript — those copies aren&apos;t counted again, so totals are
        lower (and truer) than tools that count every transcript line.
      </TooltipContent>
    </Tooltip>
  );
}
