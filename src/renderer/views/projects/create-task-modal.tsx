import { ChevronDown, ChevronRight, FolderOpen, GitBranch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import { Branch } from '@shared/git';
import { formatIssueAsPrompt, Issue } from '@shared/tasks';
import { AgentSelector } from '@renderer/components/agent-selector';
import { IssueSelector } from '@renderer/components/issue-selector';
import { ProjectSelector } from '@renderer/components/project-selector';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible';
import { ComboboxTrigger, ComboboxValue } from '@renderer/components/ui/combobox';
import { ConfirmButton } from '@renderer/components/ui/confirm-button';
import {
  DialogContent,
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { MicroLabel } from '@renderer/components/ui/label';
import { Switch } from '@renderer/components/ui/switch';
import { Textarea } from '@renderer/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
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
        <ToggleGroup className="w-full" defaultValue={['from-branch']}>
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
        <div className="border border-border rounded-md overflow-hidden">
          <BranchSelector
            branches={branches}
            value={selectedBranch}
            onValueChange={setSelectedBranch}
            trigger={
              <ComboboxTrigger className="flex w-full items-center gap-2 justify-between  hover:bg-background-1 data-popup-open:bg-background-1  p-2 outline-none">
                <div className="flex items-center gap-2">
                  <GitBranch
                    absoluteStrokeWidth
                    strokeWidth={1}
                    className="size-8 shrink-0 text-foreground-passive"
                  />
                  <div className="flex flex-col text-left text-sm">
                    <MicroLabel className="text-foreground-passive text-xs">From Branch</MicroLabel>
                    <ComboboxValue placeholder="Select a branch" />
                  </div>
                </div>
                <ChevronDown className="size-4 shrink-0 text-foreground-passive" />
              </ComboboxTrigger>
            }
          />
          <Collapsible className="border-t border-border">
            <CollapsibleTrigger className="w-full p-2 hover:bg-background-1 data-open:bg-background-1 flex text-xs text-foreground-muted items-center gap-2 justify-between">
              Should create and push feature branch
              <ChevronDown className="size-4 shrink-0 text-foreground-passive" />
            </CollapsibleTrigger>
            <CollapsibleContent className="p-2 flex flex-col gap-2">
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
            </CollapsibleContent>
          </Collapsible>
        </div>
        <Field>
          <FieldLabel>Task name</FieldLabel>
          <Input value={taskName} onChange={(e) => handleTaskNameChange(e.target.value)} />
          {showSlugHint && (
            <p className="text-xs text-muted-foreground mt-1">
              Task names only allow lowercase letters, numbers, and hyphens.
            </p>
          )}
        </Field>
        {/* <FieldGroup>
          <Field>
            <FieldLabel>Agent</FieldLabel>
            <AgentSelector value={providerId} onChange={setProviderId} />
          </Field>

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
        </FieldGroup> */}
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton onClick={handleCreateTask} disabled={!selectedProjectId}>
          Create
        </ConfirmButton>
      </DialogFooter>
    </DialogContent>
  );
});
