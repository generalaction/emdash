import { Collapsible, Tabs } from '@emdash/ui/react/primitives';
import { ChevronRight } from 'lucide-react';
import { CheckoutPrPanel } from '@core/features/tasks/browser/task-config/checkout-pr-panel';
import { NewWorktreePanel } from '@core/features/tasks/browser/task-config/new-worktree-panel';
import type { WorkspacePanelProps } from '@core/features/tasks/browser/task-config/new-worktree-panel';
import { PrNewBranchPanel } from '@core/features/tasks/browser/task-config/pr-new-branch-panel';
import { UseExistingPanel } from '@core/features/tasks/browser/task-config/use-existing-panel';
import { WorkspacePresetPicker } from '@core/features/tasks/browser/task-config/workspace-preset-picker';
import { WorktreeDestinationPreview } from '@core/features/tasks/browser/task-config/worktree-destination-preview';
import { useTaskState } from '@core/features/tasks/contributions/browser/task-config/task-state-context';
import { cn } from '@core/primitives/styling/browser/cn';
import type { WorkspacePresetId } from '@core/primitives/workspaces/api';

const PRESET_PANELS: Record<
  Exclude<WorkspacePresetId, 'repo-root'>,
  React.ComponentType<WorkspacePanelProps>
> = {
  'new-worktree': NewWorktreePanel,
  'use-existing': UseExistingPanel,
  'checkout-pr': CheckoutPrPanel,
  'pr-new-branch': PrNewBranchPanel,
};

/** Presets with no configurable settings — the collapsible is disabled for these. */
const PRESETS_WITHOUT_SETTINGS = new Set<WorkspacePresetId>(['repo-root']);

interface WorkspaceSettingsSectionProps {
  defaultOpen?: boolean;
}

export function WorkspaceSettingsSection({ defaultOpen = true }: WorkspaceSettingsSectionProps) {
  const { workspaceConfig, projectId, isUnborn, hasRepository, hasPR } = useTaskState();

  const { presetId, branchSelection } = workspaceConfig;
  const { createBranchAndWorktree, setCreateBranchAndWorktree } = branchSelection;

  const worktreesDisabledReason = !hasRepository
    ? 'Folder is not a Git repository'
    : isUnborn
      ? 'Repository has no commits yet'
      : undefined;
  const hasSettings = !PRESETS_WITHOUT_SETTINGS.has(presetId);
  const Panel = PRESET_PANELS[presetId as Exclude<WorkspacePresetId, 'repo-root'>];

  return (
    <div className="flex flex-col gap-4">
      <WorkspacePresetPicker
        value={presetId}
        onValueChange={workspaceConfig.setPresetId}
        hasPR={hasPR}
        hasExistingWorkspaces={workspaceConfig.workspaceOptions.some(
          (workspace) => !!workspace.workspaceId && !workspace.disabledReason
        )}
        worktreesDisabledReason={worktreesDisabledReason}
      />
      <Collapsible.Root
        key={presetId}
        defaultOpen={hasSettings && defaultOpen}
        disabled={!hasSettings}
        className="group flex flex-col gap-1.5"
      >
        <div className="grid h-9 grid-cols-[minmax(0,1fr)_auto] items-center">
          <Collapsible.Trigger
            hideChevron
            className={cn(
              'flex w-full items-center gap-2 text-sm outline-none',
              !hasSettings && 'cursor-not-allowed opacity-40'
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-foreground-muted">Settings</span>
              <ChevronRight className="ml-auto size-3.5 shrink-0 text-foreground-passive transition-transform duration-150 group-data-open:rotate-90" />
            </span>
          </Collapsible.Trigger>
          {presetId === 'new-worktree' && (
            <Tabs.Root
              value={createBranchAndWorktree ? 'create' : 'checkout'}
              onValueChange={(v) => setCreateBranchAndWorktree(v === 'create')}
            >
              <Tabs.List>
                <Tabs.Tab value="checkout">Checkout branch</Tabs.Tab>
                <Tabs.Tab value="create">Create new branch</Tabs.Tab>
              </Tabs.List>
            </Tabs.Root>
          )}
        </div>

        {hasSettings && (
          <Collapsible.Panel className="flex flex-col gap-3">
            <Panel workspaceConfig={workspaceConfig} projectId={projectId} isUnborn={isUnborn} />
          </Collapsible.Panel>
        )}
      </Collapsible.Root>
      {projectId ? (
        <WorktreeDestinationPreview
          projectId={projectId}
          workspaceConfig={workspaceConfig.resolvedConfig}
        />
      ) : null}
    </div>
  );
}
