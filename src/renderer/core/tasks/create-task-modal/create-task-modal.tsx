import { ChevronRight, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { ProjectSelector } from '@renderer/components/project-selector';
import { AnimatedHeight } from '@renderer/components/ui/animated-height';
import { ComboboxTrigger, ComboboxValue } from '@renderer/components/ui/combobox';
import { ConfirmButton } from '@renderer/components/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { useRepository } from '@renderer/core/projects/use-repository';
import { appState } from '@renderer/core/stores/app-state';
import { MountedProject } from '@renderer/core/stores/project';
import {
  getProjectManagerStore,
  mountedProjectData,
} from '@renderer/core/stores/project-selectors';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { parseGithubNameWithOwner } from '@renderer/views/tasks/diff-viewer/utils';
import { FromBranchContent } from './from-branch-content';
import { FromIssueContent } from './from-issue-content';
import { FromPrContent } from './from-pr-content';
import { useFromBranchMode } from './use-from-branch-mode';
import { useFromIssueMode } from './use-from-issue-mode';
import { useFromPullRequestMode } from './use-from-pull-request-mode';

type CreateTaskStrategy = 'from-branch' | 'from-issue' | 'from-pull-request';

export const CreateTaskModal = observer(function CreateTaskModal({
  projectId,
  strategy = 'from-branch',
  initialPR,
  onClose,
}: BaseModalProps & {
  projectId?: string;
  strategy?: CreateTaskStrategy;
  initialPR?: PullRequest;
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    if (projectId) return projectId;
    const nav = appState.navigation;
    const navProjectId =
      nav.currentViewId === 'task'
        ? (nav.viewParamsStore['task'] as { projectId?: string } | undefined)?.projectId
        : nav.currentViewId === 'project'
          ? (nav.viewParamsStore['project'] as { projectId?: string } | undefined)?.projectId
          : undefined;
    return (
      navProjectId ??
      Array.from(getProjectManagerStore().projects.values())
        .reverse()
        .find((p) => p.state === 'mounted')?.data?.id
    );
  });
  const [selectedStrategy, setSelectedStrategy] = useState<CreateTaskStrategy>(strategy);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const { branches, defaultBranch } = useRepository(selectedProjectId);
  const { navigate } = useNavigate();

  const projectData = selectedProjectId
    ? mountedProjectData(getProjectManagerStore().projects.get(selectedProjectId))
    : null;
  const nameWithOwner = projectData?.gitRemote
    ? (parseGithubNameWithOwner(projectData.gitRemote) ?? undefined)
    : undefined;

  const fromBranch = useFromBranchMode(selectedProjectId, defaultBranch);
  const fromIssue = useFromIssueMode(selectedProjectId, defaultBranch);
  const fromPR = useFromPullRequestMode(selectedProjectId, defaultBranch, initialPR);

  const activeMode = {
    'from-branch': fromBranch,
    'from-issue': fromIssue,
    'from-pull-request': fromPR,
  }[selectedStrategy];
  const canCreate = !!selectedProjectId && activeMode.isValid;

  const handleCreateTask = useCallback(() => {
    if (!selectedProjectId) return;
    const id = crypto.randomUUID();
    const projectStore = getProjectManagerStore().projects.get(selectedProjectId);
    if (projectStore?.state !== 'mounted') return;

    switch (selectedStrategy) {
      case 'from-branch':
        void (projectStore as MountedProject).taskManager.createTask({
          id,
          projectId: selectedProjectId,
          name: fromBranch.taskName,
          sourceBranch: { branch: fromBranch.selectedBranch?.branch ?? '', remote: 'origin' },
          strategy: fromBranch.createBranchAndWorktree
            ? {
                kind: 'new-branch',
                taskBranch: fromBranch.taskName,
                pushBranch: fromBranch.pushBranch,
              }
            : { kind: 'no-worktree' },
        });
        break;
      case 'from-issue':
        void (projectStore as MountedProject).taskManager.createTask({
          id,
          projectId: selectedProjectId,
          name: fromIssue.taskName,
          sourceBranch: { branch: fromIssue.selectedBranch?.branch ?? '', remote: 'origin' },
          strategy: { kind: 'no-worktree' },
          linkedIssue: fromIssue.linkedIssue ?? undefined,
        });
        break;
      case 'from-pull-request':
        if (!fromPR.linkedPR) return;
        void (projectStore as MountedProject).taskManager.createTask({
          id,
          projectId: selectedProjectId,
          name: fromPR.taskName,
          sourceBranch: { branch: fromPR.linkedPR.metadata.headRefName, remote: 'origin' },
          strategy:
            fromPR.checkoutMode === 'checkout'
              ? {
                  kind: 'from-pull-request',
                  prNumber: fromPR.linkedPR.metadata.number,
                  headBranch: fromPR.linkedPR.metadata.headRefName,
                }
              : {
                  kind: 'from-pull-request',
                  prNumber: fromPR.linkedPR.metadata.number,
                  headBranch: fromPR.linkedPR.metadata.headRefName,
                  taskBranch: fromPR.taskName,
                },
        });
        break;
    }

    navigate('task', { projectId: selectedProjectId, taskId: id });
    onClose();
  }, [selectedProjectId, selectedStrategy, fromBranch, fromIssue, fromPR, navigate, onClose]);

  return (
    <>
      <DialogHeader className="flex items-center gap-2">
        <ProjectSelector
          value={selectedProjectId}
          onChange={setSelectedProjectId}
          trigger={
            <ComboboxTrigger className="h-6 flex items-center gap-2 border border-border rounded-md px-2.5 py-1 text-sm outline-none">
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
              <ComboboxValue placeholder="Select a project" />
            </ComboboxTrigger>
          }
        />
        <ChevronRight className="size-3.5 text-foreground-passive" />
        <DialogTitle>Create Task</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-4">
        <ToggleGroup
          className="w-full"
          value={[selectedStrategy]}
          onValueChange={([value]) => {
            if (value) {
              setSelectedStrategy(value as CreateTaskStrategy);
            }
          }}
        >
          <ToggleGroupItem className="flex-1" value="from-branch">
            From Branch
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-issue">
            From Issue
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="from-pull-request">
            From Pull Request
          </ToggleGroupItem>
        </ToggleGroup>
        <AnimatedHeight onAnimatingChange={setIsTransitioning}>
          {selectedStrategy === 'from-branch' && (
            <FromBranchContent state={fromBranch} branches={branches} />
          )}
          {selectedStrategy === 'from-issue' && (
            <FromIssueContent state={fromIssue} branches={branches} disabled={isTransitioning} />
          )}
          {selectedStrategy === 'from-pull-request' && (
            <FromPrContent
              state={fromPR}
              projectId={selectedProjectId}
              nameWithOwner={nameWithOwner}
              disabled={isTransitioning}
            />
          )}
        </AnimatedHeight>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton size="sm" onClick={handleCreateTask} disabled={!canCreate}>
          Create
        </ConfirmButton>
      </DialogFooter>
    </>
  );
});
