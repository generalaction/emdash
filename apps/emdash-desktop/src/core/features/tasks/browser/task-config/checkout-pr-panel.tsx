import type { WorkspacePanelProps } from './new-worktree-panel';
import { SetupStepPreview } from './setup-step-preview';

export function CheckoutPrPanel({ workspaceConfig }: WorkspacePanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-foreground-muted">
        The PR branch will be fetched and checked out in a dedicated worktree. No new branch will be
        created.
      </p>
      <SetupStepPreview steps={workspaceConfig.setupSteps} />
    </div>
  );
}
