import { Box, GitBranch, TreePine } from 'lucide-react';
import { cn } from '@renderer/utils/utils';
import { OptionButtonCard } from '@renderer/lib/components/option-button-card';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { ComboboxTrigger } from '@renderer/lib/ui/combobox';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { MiniTabs } from '@renderer/lib/ui/mini-tabs';
import { Switch } from '@renderer/lib/ui/switch';
import { CheckoutModeGroup } from './checkout-mode-group';
import type { CreateTaskState } from './use-create-task-state';
import type { WorkspaceModeState } from './use-workspace-mode';
import { WorkspaceSettingsAccordion } from './workspace-settings-accordion';
import { RepositoryPicker } from './workspace-picker/repository-picker';
import { WorkspacePicker } from './workspace-picker/workspace-picker';

interface WorkspaceSettingsSectionProps {
  state: CreateTaskState;
  projectId?: string;
  currentBranch?: string | null;
  isUnborn?: boolean;
  workspaceMode: WorkspaceModeState;
  workspaceType: 'worktree' | 'byoi';
  setWorkspaceType: (t: 'worktree' | 'byoi') => void;
  byoiRepoUrl: string;
  setByoiRepoUrl: (url: string) => void;
  defaultRepoUrl?: string;
  isWorkspaceProviderEnabled: boolean;
}

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
  workspaceType,
  setWorkspaceType,
  byoiRepoUrl,
  setByoiRepoUrl,
  defaultRepoUrl,
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
            <div className="flex flex-col gap-3 p-3">
              {/* Workspace type selector */}
              {isWorkspaceProviderEnabled && (
                <div className="flex gap-2">
                  <OptionButtonCard
                    active={workspaceType === 'worktree'}
                    onClick={() => setWorkspaceType('worktree')}
                    icon={<TreePine absoluteStrokeWidth strokeWidth={1.5} className="size-4" />}
                    title="Worktree"
                    description="Create a Git worktree on a local or remote repository."
                  />
                  <OptionButtonCard
                    active={workspaceType === 'byoi'}
                    onClick={() => setWorkspaceType('byoi')}
                    icon={<Box absoluteStrokeWidth strokeWidth={1.5} className="size-4" />}
                    title="Sandbox"
                    description="Run the task on your own infrastructure."
                  />
                </div>
              )}

              {/* Worktree fields */}
              {workspaceType === 'worktree' && (
                <div className="flex flex-col gap-2">
                  {/* Header row: label + branch mode tabs */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground-muted tracking-tight">
                      Worktree Settings
                    </span>
                    <MiniTabs
                      value={state.branchTab}
                      onValueChange={(v) => state.setBranchTab(v as 'create' | 'checkout')}
                      tabs={BRANCH_TABS}
                    />
                  </div>

                  {/* Card */}
                  <div className="flex flex-col overflow-hidden rounded-lg border border-border">
                    {/* Repository picker — flush at top */}
                    {projectId && (
                      <RepositoryPicker
                        projectId={projectId}
                        value={state.selectedInstanceId}
                        onChange={state.setSelectedInstanceId}
                        triggerClassName="border-b border-border"
                      />
                    )}

                    {/* Branch selector — flush, full width */}
                    {projectId && (
                      <ProjectBranchSelector
                        projectId={projectId}
                        value={state.branchSelection.selectedBranch}
                        onValueChange={state.branchSelection.setSelectedBranch}
                        showRemoteSelectorFooter
                        trigger={
                          <ComboboxTrigger
                            className={cn(
                              'flex w-full flex-col gap-0.5 border-t rounded-none px-2.5 py-2 text-sm outline-none hover:bg-background-1 data-popup-open:bg-background-1',
                              state.branchTab === 'create' && 'border-b border-border'
                            )}
                          >
                            <span className="text-left text-xs text-foreground-muted">
                              {state.branchTab === 'create' ? 'From Branch' : 'Branch'}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <GitBranch
                                absoluteStrokeWidth
                                strokeWidth={2}
                                className="size-3.5 shrink-0 text-foreground-muted"
                              />
                              <span className="truncate text-foreground">
                                {state.branchSelection.selectedBranch?.branch ?? (
                                  <span className="text-foreground-passive">—</span>
                                )}
                              </span>
                            </span>
                          </ComboboxTrigger>
                        }
                      />
                    )}

                    {/* Branch name — inset, only in create mode */}
                    {projectId && state.branchTab === 'create' && !isUnborn && (
                      <div className="flex flex-col gap-1 p-3">
                        <div className="flex flex-col gap-0">
                          <span className="text-xs text-foreground-muted">Branch Name</span>
                          <Input
                            value={
                              state.branchNameState.isUserModified
                                ? state.branchNameState.branchName
                                : ''
                            }
                            onChange={(e) => state.branchNameState.setBranchName(e.target.value)}
                            placeholder={state.branchNameState.branchName || 'branch-name'}
                            className="font-mono text-sm border-none px-0 focus-visible:ring-0"
                          />
                          </div>

                        {state.branchNameState.branchAlreadyExists && (
                          <p className="text-xs text-foreground-muted">
                            This branch already exists — the task will check it out instead of
                            creating a new one.
                          </p>
                        )}
                        <Field orientation="horizontal">
                          <Switch
                            size="sm"
                            checked={state.branchSelection.pushBranch}
                            onCheckedChange={state.branchSelection.setPushBranch}
                          />
                          <FieldLabel>Push branch to remote</FieldLabel>
                        </Field>
                      </div>
                    )}

                    {/* Unborn notice — inset */}
                    {projectId && isUnborn && (
                      <div className="p-3">
                        <p className="rounded-md border border-border bg-background-1 px-2 py-1.5 text-xs text-foreground-muted">
                          Create an initial commit to enable branch-based tasks.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sandbox fields */}
              {workspaceType === 'byoi' && (
                <div className="flex flex-col gap-1">
                <Field >
                  <FieldLabel className="text-xs">Repository URL</FieldLabel>
                  <input
                    value={byoiRepoUrl}
                    onChange={(e) => setByoiRepoUrl(e.target.value)}
                    placeholder={defaultRepoUrl ?? 'https://github.com/org/repo'}
                    className="flex w-full rounded-md border border-border bg-background px-2.5 py-1 text-sm outline-none placeholder:text-foreground-passive hover:bg-background-1 focus:bg-background-1"
                  />
                </Field>
                  </div>
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
