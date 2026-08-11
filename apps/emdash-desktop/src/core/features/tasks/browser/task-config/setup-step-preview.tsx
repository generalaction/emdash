import { Collapsible } from '@emdash/ui/react/primitives';
import { ChevronDown, Terminal } from 'lucide-react';
import type { WorktreeSetupStep } from '@core/primitives/workspaces/api';

interface SetupStepPreviewProps {
  steps: WorktreeSetupStep[];
}

/**
 * A collapsible read-only list of the lifecycle steps that will run when the
 * workspace is provisioned — a projection of the compiled worktree git plan, carrying
 * the same step ids the Activity badge shows live. Collapsed by default.
 */
export function SetupStepPreview({ steps }: SetupStepPreviewProps) {
  if (steps.length === 0) return null;

  return (
    <Collapsible.Root className="rounded-md border border-border">
      <Collapsible.Trigger
        hideChevron
        className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-xs text-foreground-muted hover:bg-background-1 data-open:bg-background-1"
      >
        <span className="flex items-center gap-1.5">
          <Terminal className="size-3 shrink-0" />
          Setup steps ({steps.length})
        </span>
        <ChevronDown className="size-3.5 shrink-0 transition-transform duration-150 data-[state=open]:rotate-180" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out">
        <ol className="flex flex-col gap-1 border-t border-border px-2.5 py-2">
          {steps.map((step, i) => (
            <li
              key={step.id}
              data-step={step.id}
              className="flex items-start gap-2 text-xs text-foreground-muted"
            >
              <span className="mt-px shrink-0 font-sans text-foreground-passive">{i + 1}.</span>
              <span className="flex min-w-0 flex-col">
                <span className="text-foreground">{step.title}</span>
                <span className="text-[11px]">{step.description}</span>
              </span>
            </li>
          ))}
        </ol>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
