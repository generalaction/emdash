import { ChevronDown, GitBranch } from 'lucide-react';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { ComboboxTrigger } from '@renderer/lib/ui/combobox';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { MiniTabs } from '@renderer/lib/ui/mini-tabs';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { BranchNameField } from './branch-name-field';
import { CheckoutModeGroup } from './checkout-mode-group';
import type { CreateTaskState } from './use-create-task-state';
import type { WorkspaceModeState } from './use-workspace-mode';
import { WorkspaceSettingsAccordion } from './workspace-settings-accordion';
import { RepositoryPicker } from './workspace-picker/repository-picker';
import { WorkspacePicker } from './workspace-picker/workspace-picker';
import { PickerRepoRowContent, PickerWorktreeRowContent } from './workspace-picker/workspace-picker-rows';

interface WorkspaceSettingsSectionProps {
  state: CreateTaskState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
  workspaceMode: WorkspaceModeState;
  useBYOI: boolean;
  setUseBYOI: (value: boolean) => void;
  isWorkspaceProviderEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

const BRANCH_TABS = [
  { value: 'create', label: 'Create Branch' },
  { value: 'checkout', label: 'Checkout Branch' },
];

export function WorkspaceSettingsSection({
  state,
  projectId,
  currentBranch: _currentBranch,
  isUnborn,
  workspaceMode,
  useBYOI,
  setUseBYOI,
  isWorkspaceProviderEnabled,
}: WorkspaceSettingsSectionProps) {
  const showPrWorkspace = state.linkedType === 'pr' && state.linkedPR !== null;

  return (
    <div className="flex flex-col gap-4">
      {showPrWorkspace ? (
        <CheckoutModeGroup
          value={state.checkoutMode}
          onValueChange={state.setCheckoutMode}
          pushBranch={state.branchSelection.pushBranch}
          onPushBranchChange={state.branchSelection.setPushBranch}
        />
      ) : (
        <WorkspaceSettingsAccordion
          value={workspaceMode.mode}
          onValueChange={(v) => workspaceMode.setMode(v)}
          newContent={
            <div className="flex flex-col gap-3">
              {/* Repository combobox */}
              {projectId && (
                <Field>
                  <FieldLabel className="text-xs">Repository</FieldLabel>
                  <RepositoryPicker
                    projectId={projectId}
                    value={state.selectedInstanceId}
                    onChange={state.setSelectedInstanceId}
                  />
                </Field>
              )}

              {/* Branch mode tabs */}
              <MiniTabs
                value={state.branchTab}
                onValueChange={(v) => state.setBranchTab(v as 'create' | 'checkout')}
                tabs={BRANCH_TABS}
                stretch
                className="w-full"
              />

              {/* Source / checkout branch selector */}
              {projectId && (
                <Field>
                  <FieldLabel className="text-xs">
                    {state.branchTab === 'create' ? 'From Branch' : 'Branch'}
                  </FieldLabel>
                  <ProjectBranchSelector
                    projectId={projectId}
                    value={state.branchSelection.selectedBranch}
                    onValueChange={state.branchSelection.setSelectedBranch}
                    showRemoteSelectorFooter
                    trigger={
                      <ComboboxTrigger
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 text-sm outline-none',
                          'hover:bg-background-1 data-popup-open:bg-background-1'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <GitBranch
                            absoluteStrokeWidth
                            strokeWidth={2}
                            className="size-3.5 shrink-0 text-foreground-muted"
                          />
                          <span className="truncate text-foreground">
                            {state.branchSelection.selectedBranch?.branch ?? (
                              <span className="text-foreground-muted">Select a branch</span>
                            )}
                          </span>
                        </span>
                        <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
                      </ComboboxTrigger>
                    }
                  />
                </Field>
              )}

              {/* Create-only: branch name + push toggle */}
              {state.branchTab === 'create' && !isUnborn && (
                <>
                  <BranchNameField state={state.branchNameState} />
                  <Field orientation="horizontal">
                    <Switch
                      size="sm"
                      checked={state.branchSelection.pushBranch}
                      onCheckedChange={state.branchSelection.setPushBranch}
                    />
                    <FieldLabel>Push branch to remote</FieldLabel>
                  </Field>
                </>
              )}

              {isUnborn && (
                <p className="rounded-md border border-border bg-background-1 px-2 py-1.5 text-xs text-foreground-muted">
                  Create an initial commit to enable branch-based tasks.
                </p>
              )}
            </div>
          }
          existingContent={
            projectId ? (
              <WorkspacePicker
                projectId={projectId}
                value={workspaceMode.selectedEntry}
                onChange={workspaceMode.setSelectedEntry}
              />
            ) : null
          }
        />
      )}
    </div>
  );
}
