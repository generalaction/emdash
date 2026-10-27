import { Collapsible } from '@emdash/ui/react/primitives';
import { ChevronDown, Info } from 'lucide-react';
import { cn } from '@core/primitives/styling/browser/cn';
import type { WorkspacePresetId } from '@core/primitives/workspaces/api';

// ---------------------------------------------------------------------------
// Intent text per preset
// ---------------------------------------------------------------------------

export function getWorkspaceIntent(presetId: WorkspacePresetId, createBranch: boolean): string {
  switch (presetId) {
    case 'new-worktree':
      return createBranch
        ? 'Creates a new branch and an isolated worktree'
        : 'Checks out an existing branch in a new isolated worktree';
    case 'repo-root':
      return 'Uses the repository root directly — no worktree is created';
    case 'use-existing':
      return 'Reuses an existing workspace, no git setup required';
    case 'checkout-pr':
      return 'Fetches and checks out the PR branch in a dedicated worktree';
    case 'pr-new-branch':
      return 'Creates a new branch on top of the PR head in a dedicated worktree';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface WorkspaceSummaryAlertProps {
  description: string;
  steps: string[];
  className?: string;
}

export function WorkspaceSummaryAlert({
  description,
  steps,
  className,
}: WorkspaceSummaryAlertProps) {
  const hasSteps = steps.length > 0;

  return (
    <Collapsible.Root
      disabled={!hasSteps}
      className={cn(
        'rounded-md border bg-background-info border-border-info text-foreground-info text-xs',
        className
      )}
    >
      <Collapsible.Trigger
        hideChevron
        className={cn('flex w-full items-center gap-2 px-3 py-2 text-left outline-none')}
      >
        <Info className="size-3.5 shrink-0" />
        <span className="flex-1">{description}</span>
        {hasSteps && (
          <ChevronDown className="size-3.5 shrink-0 transition-transform duration-150 group-data-open:rotate-180" />
        )}
      </Collapsible.Trigger>

      {hasSteps && (
        <Collapsible.Panel className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out">
          <ol className="flex flex-col gap-0.5 border-t border-border px-3 py-2">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-foreground-muted">
                <span className="mt-px shrink-0 font-sans text-foreground-passive">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Collapsible.Panel>
      )}
    </Collapsible.Root>
  );
}
