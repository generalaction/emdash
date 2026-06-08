import { ChevronDown, Terminal } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';

interface SetupStepPreviewProps {
  steps: string[];
}

/**
 * A collapsible read-only list of git setup steps that will run when the
 * workspace is provisioned. Collapsed by default to stay out of the way.
 */
export function SetupStepPreview({ steps }: SetupStepPreviewProps) {
  if (steps.length === 0) return null;

  return (
    <Collapsible className="rounded-md border border-border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-xs text-foreground-muted hover:bg-background-1 data-open:bg-background-1">
        <span className="flex items-center gap-1.5">
          <Terminal className="size-3 shrink-0" />
          Setup steps ({steps.length})
        </span>
        <ChevronDown className="size-3.5 shrink-0 transition-transform duration-150 data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out">
        <ol className="flex flex-col gap-0.5 border-t border-border px-2.5 py-2">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-foreground-muted">
              <span className="mt-px shrink-0 font-mono text-foreground-passive">{i + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
