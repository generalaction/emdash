import { ChevronRight, FolderOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useState } from 'react';
import { ProjectSelector } from '@renderer/components/project-selector';
import { ComboboxTrigger, ComboboxValue } from '@renderer/components/ui/combobox';
import { ConfirmButton } from '@renderer/components/ui/confirm-button';
import {
  DialogContent,
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { useRepository } from '@renderer/core/projects/use-repository';
import { MountedProject } from '@renderer/core/stores/project';
import { projectManagerStore } from '@renderer/core/stores/project-manager';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { FromBranchContent } from './from-branch-content';
import { FromIssueContent } from './from-issue-content';
import { useFromBranchMode } from './use-from-branch-mode';
import { useFromIssueMode } from './use-from-issue-mode';
import { useFromPullRequestMode } from './use-from-pull-request-mode';

type CreateTaskStrategy = 'from-branch' | 'from-issue' | 'from-pull-request';

export const CreateTaskModal = observer(function CreateTaskModal({
  projectId,
  strategy = 'from-branch',
  onClose,
}: BaseModalProps & { projectId?: string; strategy?: CreateTaskStrategy }) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(projectId);
  const [selectedStrategy, setSelectedStrategy] = useState<CreateTaskStrategy>(strategy);
  const { branches, defaultBranch } = useRepository(selectedProjectId);
  const { navigate } = useNavigate();

  const fromBranch = useFromBranchMode(selectedProjectId, defaultBranch);
  const fromIssue = useFromIssueMode(selectedProjectId, defaultBranch);
  const _fromPR = useFromPullRequestMode();

  const handleCreateTask = useCallback(() => {
    if (!selectedProjectId) return;
    const id = crypto.randomUUID();
    const projectStore = projectManagerStore.projects.get(selectedProjectId);
    if (projectStore?.state !== 'mounted') return;

    switch (selectedStrategy) {
      case 'from-branch':
        void (projectStore as MountedProject).taskManager.createTask({
          id,
          projectId: selectedProjectId,
          name: fromBranch.taskName,
          sourceBranch: fromBranch.selectedBranch?.branch ?? '',
          taskBranch: fromBranch.createBranchAndWorktree ? fromBranch.taskName : undefined,
          pushBranch: fromBranch.createBranchAndWorktree ? fromBranch.pushBranch : undefined,
        });
        break;
      case 'from-issue':
        void (projectStore as MountedProject).taskManager.createTask({
          id,
          projectId: selectedProjectId,
          name: fromIssue.taskName,
          sourceBranch: fromIssue.selectedBranch?.branch ?? '',
          linkedIssue: fromIssue.linkedIssue ?? undefined,
        });
        break;
      case 'from-pull-request':
        // TODO: implement from-pull-request creation
        break;
    }

    onClose();
    navigate('task', { projectId: selectedProjectId, taskId: id });
  }, [selectedProjectId, selectedStrategy, fromBranch, fromIssue, onClose, navigate]);

  return (
    <DialogContent>
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
      <DialogContentArea className="pt-0 space-y-2">
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
        {selectedStrategy === 'from-branch' && (
          <FromBranchContent state={fromBranch} branches={branches} />
        )}
        {selectedStrategy === 'from-issue' && (
          <FromIssueContent state={fromIssue} branches={branches} />
        )}
        {selectedStrategy === 'from-pull-request' && (
          <div className="text-sm text-muted-foreground py-4 text-center">
            From Pull Request — coming soon
          </div>
        )}
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton size="sm" onClick={handleCreateTask} disabled={!selectedProjectId}>
          Create
        </ConfirmButton>
      </DialogFooter>
    </DialogContent>
  );
});
