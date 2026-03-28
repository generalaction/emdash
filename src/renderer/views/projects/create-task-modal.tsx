import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import { Branch } from '@shared/git';
import { formatIssueAsPrompt, Issue } from '@shared/tasks';
import { AgentSelector } from '@renderer/components/agent-selector';
import { IssueSelector } from '@renderer/components/issue-selector';
import { ProjectSelector } from '@renderer/components/project-selector';
import { ConfirmButton } from '@renderer/components/ui/confirm-button';
import {
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { Switch } from '@renderer/components/ui/switch';
import { Textarea } from '@renderer/components/ui/textarea';
import { BaseModalProps } from '@renderer/core/modal/modal-provider';
import { useRepository } from '@renderer/core/projects/use-repository';
import { MountedProject } from '@renderer/core/stores/project';
import { projectManagerStore } from '@renderer/core/stores/project-manager';
import { useNavigate } from '@renderer/core/view/navigation-provider';
import { generateFriendlyTaskName, liveTransformTaskName } from '@renderer/lib/taskNames';
import { BranchSelector } from './branch-selector';

export const CreateTaskModal = observer(function CreateTaskModal({
  projectId,
  onClose,
}: BaseModalProps & { projectId?: string }) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(projectId);
  const selectedProjectData = selectedProjectId
    ? projectManagerStore.projects.get(selectedProjectId)?.data
    : undefined;
  const connectionId =
    selectedProjectData?.type === 'ssh' ? selectedProjectData.connectionId : undefined;
  const { branches, defaultBranch } = useRepository(selectedProjectId);
  const { navigate } = useNavigate();
  const [selectedBranch, setSelectedBranch] = useState<Branch | undefined>(undefined);
  const [providerId, setProviderId] = useState<AgentProviderId>('claude');
  const [createBranchAndWorktree, setCreateBranchAndWorktree] = useState(true);
  const [pushBranch, setPushBranch] = useState(false);
  const [autoApprove, setAutoApprove] = useState(false);
  const [taskName, setTaskName] = useState(generateFriendlyTaskName());
  const [showSlugHint, setShowSlugHint] = useState(false);
  const [linkedIssue, setLinkedIssue] = useState<Issue | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (defaultBranch) {
      setSelectedBranch({ type: 'local', branch: defaultBranch.name });
    } else {
      setSelectedBranch(undefined);
    }
  }, [selectedProjectId, defaultBranch]);

  const handleTaskNameChange = useCallback((value: string) => {
    const transformed = liveTransformTaskName(value);
    setTaskName(transformed);
    const hasDroppedChars = /[^a-z0-9\s-]/i.test(value);
    setShowSlugHint(hasDroppedChars);
  }, []);

  const handleCreateTask = useCallback(() => {
    if (!selectedProjectId) return;
    const id = crypto.randomUUID();
    const prompt = linkedIssue ? formatIssueAsPrompt(linkedIssue, initialPrompt) : undefined;
    const projectStore = projectManagerStore.projects.get(selectedProjectId);
    if (projectStore?.state === 'mounted') {
      void (projectStore as MountedProject).taskManager.createTask({
        id,
        projectId: selectedProjectId,
        name: taskName,
        sourceBranch: {
          branch: selectedBranch?.branch ?? '',
          remote: selectedBranch?.remote ?? '',
        },
        taskBranch: createBranchAndWorktree ? taskName : undefined,
        linkedIssue: linkedIssue ?? undefined,
        pushBranch: createBranchAndWorktree ? pushBranch : undefined,
        initialConversation: prompt
          ? {
              id: crypto.randomUUID(),
              projectId: selectedProjectId,
              taskId: id,
              provider: providerId,
              title: `${providerId} (1)`,
              autoApprove: autoApprove,
              initialPrompt: prompt,
            }
          : undefined,
      });
    }
    onClose();
    navigate('task', { projectId: selectedProjectId, taskId: id });
  }, [
    selectedProjectId,
    selectedBranch,
    taskName,
    createBranchAndWorktree,
    pushBranch,
    linkedIssue,
    onClose,
    navigate,
    providerId,
    autoApprove,
    initialPrompt,
  ]);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create Task</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-2 w-full">
        <FieldGroup>
          <Field>
            <FieldLabel>Project</FieldLabel>
            <ProjectSelector value={selectedProjectId} onChange={setSelectedProjectId} />
          </Field>
          <Field>
            <FieldLabel>From Branch</FieldLabel>
            <BranchSelector
              branches={branches}
              value={selectedBranch}
              onValueChange={setSelectedBranch}
            />
          </Field>
          <Field>
            <FieldLabel>Task name</FieldLabel>
            <Input value={taskName} onChange={(e) => handleTaskNameChange(e.target.value)} />
            {showSlugHint && (
              <p className="text-xs text-muted-foreground mt-1">
                Task names only allow lowercase letters, numbers, and hyphens.
              </p>
            )}
          </Field>
          <Field>
            <FieldLabel>Agent</FieldLabel>
            <AgentSelector
              value={providerId}
              onChange={setProviderId}
              connectionId={connectionId}
            />
          </Field>
          <Field orientation="horizontal">
            <Switch
              checked={createBranchAndWorktree}
              onCheckedChange={setCreateBranchAndWorktree}
            />
            <FieldLabel>Create task branch and worktree</FieldLabel>
          </Field>

          {createBranchAndWorktree && (
            <Field orientation="horizontal">
              <Switch checked={pushBranch} onCheckedChange={setPushBranch} />
              <FieldLabel>Push branch to remote</FieldLabel>
            </Field>
          )}

          <Field>
            <FieldLabel>Attach an issue</FieldLabel>
            <IssueSelector nameWithOwner="" value={linkedIssue} onValueChange={setLinkedIssue} />
          </Field>

          <Field>
            <FieldLabel>Initial prompt</FieldLabel>
            <Textarea value={initialPrompt} onChange={(e) => setInitialPrompt(e.target.value)} />
          </Field>
          <Field orientation="horizontal">
            <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
            <FieldLabel>Auto approve</FieldLabel>
          </Field>
        </FieldGroup>
      </div>
      <DialogFooter>
        <ConfirmButton onClick={handleCreateTask} disabled={!selectedProjectId}>
          Create
        </ConfirmButton>
      </DialogFooter>
    </DialogContent>
  );
});
