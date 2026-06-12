import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export function StatCard({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background-1 px-4 py-3">
      <div className="text-xl font-semibold text-foreground tabular-nums">{value}</div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-foreground-muted">
        {label}
        {hint ? (
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3 w-3 text-foreground/40" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{hint}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}
