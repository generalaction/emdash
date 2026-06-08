import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { PanelTabs } from '@renderer/lib/ui/panel-tabs';
import { cn } from '@renderer/utils/utils';
import type { WorkspacePresetId } from '@shared/core/workspaces/workspace-presets';
import { CheckoutPrPanel } from './checkout-pr-panel';
import { useProjectWorkspaces } from './existing-workspace-picker';
import { NewWorktreePanel } from './new-worktree-panel';
import type { WorkspacePanelProps } from './new-worktree-panel';
import { PrNewBranchPanel } from './pr-new-branch-panel';
import { SandboxPanel } from './sandbox-panel';
import { useTaskState } from './task-state-context';
import { UseExistingPanel } from './use-existing-panel';
import { WorkspacePresetPicker } from './workspace-preset-picker';

const PRESET_PANELS: Record<
  Exclude<WorkspacePresetId, 'repo-root'>,
  React.ComponentType<WorkspacePanelProps>
> = {
  'new-worktree': NewWorktreePanel,
  'use-existing': UseExistingPanel,
  'checkout-pr': CheckoutPrPanel,
  'pr-new-branch': PrNewBranchPanel,
  sandbox: SandboxPanel,
};

/** Presets with no configurable settings — the collapsible is disabled for these. */
const PRESETS_WITHOUT_SETTINGS = new Set<WorkspacePresetId>(['repo-root', 'sandbox']);

interface WorkspaceSettingsSectionProps {
  defaultOpen?: boolean;
}

export function WorkspaceSettingsSection({ defaultOpen = true }: WorkspaceSettingsSectionProps) {
  const { workspaceConfig, projectId, isUnborn, hasPR, isWorkspaceProviderEnabled } = useTaskState();
  const { data: existingWorkspaces = [] } = useProjectWorkspaces(projectId);

  const { presetId, branchSelection } = workspaceConfig;
  const { createBranchAndWorktree, setCreateBranchAndWorktree } = branchSelection;

  const hasSettings = !PRESETS_WITHOUT_SETTINGS.has(presetId);
  const Panel = PRESET_PANELS[presetId as Exclude<WorkspacePresetId, 'repo-root'>];

  return (
    <div className="flex flex-col gap-4">
      <WorkspacePresetPicker
        value={presetId}
        onValueChange={workspaceConfig.setPresetId}
        hasPR={hasPR}
        isWorkspaceProviderEnabled={isWorkspaceProviderEnabled}
        hasExistingWorkspaces={existingWorkspaces.length > 0}
      />
      <Collapsible
        key={presetId}
        defaultOpen={hasSettings && defaultOpen}
        disabled={!hasSettings}
        className="group flex flex-col gap-1.5"
      >
        <div className="flex h-9 items-center justify-between">
          <CollapsibleTrigger
            className={cn(
              'flex w-full items-center gap-2 text-sm outline-none',
              !hasSettings && 'cursor-not-allowed opacity-40'
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-foreground-muted">Settings</span>
              <ChevronRight className="ml-auto size-3.5 shrink-0 text-foreground-passive transition-transform duration-150 group-data-open:rotate-90" />
            </span>
          </CollapsibleTrigger>
          {presetId === 'new-worktree' && (
            <PanelTabs
              compact
              className="ml-auto"
              value={createBranchAndWorktree ? 'create' : 'checkout'}
              onChange={(v: 'checkout' | 'create') => setCreateBranchAndWorktree(v === 'create')}
              tabs={[
                { value: 'checkout', label: 'Checkout branch' },
                { value: 'create', label: 'Create new branch' },
              ]}
            />
          )}
        </div>

        {hasSettings && (
          <CollapsibleContent className="flex flex-col gap-3">
            <Panel workspaceConfig={workspaceConfig} projectId={projectId} isUnborn={isUnborn} />
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}
