import { ChevronDown, GitBranch, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import type { Branch } from '@shared/git';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { BranchDisplay } from '@renderer/lib/components/branch-display';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogClose,
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Separator } from '@renderer/lib/ui/separator';
import { Textarea } from '@renderer/lib/ui/textarea';
import { log } from '@renderer/utils/logger';
import { resolveInitialBaseBranch } from './base-branch';

export type CreatePrModalArgs = {
  nameWithOwner: string; // kept as-is for modal registry compatibility; value is a repositoryUrl
  branchName: string;
  draft: boolean;
  workspaceId: string;
};

type Props = BaseModalProps<void> & CreatePrModalArgs;

export const CreatePrModal = observer(function CreatePrModal({
  nameWithOwner: repositoryUrl,
  branchName,
  draft,
  workspaceId,
  onSuccess,
  onClose,
}: Props) {
  const { projectId, taskId } = useTaskViewContext();
  const showConfirm = useShowModal('confirmActionModal');
  const [title, setTitle] = useState(branchName);
  const [description, setDescription] = useState('');
  const [selectedBaseOverride, setSelectedBaseOverride] = useState<Branch | undefined>();
  const [isCreating, setIsCreating] = useState(false);
  const repo = getRepositoryStore(projectId);
  const defaultBranch = repo?.defaultBranch;
  const taskPayload = getRegisteredTaskData(projectId, taskId);

  const hasGitHubRemote = Boolean(repositoryUrl);
  const selectedBase =
    selectedBaseOverride ??
    resolveInitialBaseBranch(
      repo?.remoteBranches ?? [],
      taskPayload?.sourceBranch.branch,
      defaultBranch
    );

  const doPushAndCreate = async (
    capturedTitle: string,
    capturedDescription: string,
    capturedBase: string
  ) => {
    setIsCreating(true);
    try {
      const pushResult = await rpc.git.push(
        projectId,
        workspaceId,
        repo?.configuredRemote.name ?? 'origin'
      );
      if (!pushResult.success) {
        log.error('Failed to push branch:', pushResult.error);
        return;
      }

      const result = await rpc.pullRequests.createPullRequest({
        repositoryUrl,
        head: branchName,
        base: capturedBase,
        title: capturedTitle,
        body: capturedDescription || undefined,
        draft,
      });

      if (result.success) {
        onSuccess();
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreate = async () => {
    if (!title.trim() || !repositoryUrl || !selectedBase?.branch) return;

    const capturedTitle = title.trim();
    const capturedDescription = description.trim();
    const capturedBase = selectedBase.branch;

    const isPushed = repo?.isBranchOnRemote(branchName) ?? false;

    if (!isPushed) {
      showConfirm({
        title: 'Push branch to remote?',
        description: `"${branchName}" hasn't been pushed yet. It needs to be pushed before opening a pull request.`,
        confirmLabel: 'Push & Create PR',
        variant: 'default',
        onSuccess: () => {
          void doPushAndCreate(capturedTitle, capturedDescription, capturedBase);
        },
      });
      return;
    }

    void doPushAndCreate(capturedTitle, capturedDescription, capturedBase);
  };

  return (
    <div className="flex flex-col overflow-hidden max-h-[70vh]">
      <DialogHeader>
        <DialogTitle>{draft ? 'Create Draft PR' : 'Create Pull Request'}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="space-y-4">
        {!hasGitHubRemote && (
          <p className="text-sm text-muted-foreground">
            No GitHub remote detected. Configure a GitHub remote to create pull requests.
          </p>
        )}
        <div className="flex items-center gap-2 flex-col">
          <BranchDisplay
            label="Head Branch"
            branchName={branchName}
            className="border border-border rounded-md"
          />
          <ProjectBranchSelector
            projectId={projectId}
            value={selectedBase}
            onValueChange={setSelectedBaseOverride}
            remoteOnly
            trigger={
              <ComboboxTrigger className="flex w-full items-center gap-2 justify-between border border-border rounded-md p-2 text-left outline-none">
                <div className="flex flex-col text-left text-sm gap-0.5">
                  <span className="text-foreground-passive text-xs">Base Branch</span>
                  <span className="flex items-center gap-1">
                    <GitBranch
                      absoluteStrokeWidth
                      strokeWidth={2}
                      className="size-3.5 shrink-0 text-foreground-muted"
                    />
                    <ComboboxValue placeholder="Select a base branch" />
                  </span>
                </div>
                <ChevronDown className="size-4 shrink-0 text-foreground-muted" />
              </ComboboxTrigger>
            }
          />
        </div>
        <Separator />
        <FieldGroup>
          <Field>
            <FieldLabel>Title</FieldLabel>
            <Input
              placeholder="PR title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!hasGitHubRemote}
            />
          </Field>
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={1}
              disabled={!hasGitHubRemote}
            />
          </Field>
        </FieldGroup>
      </DialogContentArea>
      <DialogFooter>
        <ConfirmButton
          size="sm"
          onClick={() => void handleCreate()}
          disabled={!hasGitHubRemote || !selectedBase?.branch || !title.trim() || isCreating}
        >
          {isCreating ? 'Creating...' : draft ? 'Create Draft' : 'Create PR'}
        </ConfirmButton>
      </DialogFooter>
    </div>
  );
});
