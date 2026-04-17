import { ChevronDown, GitBranch, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import type { Branch } from '@shared/git';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { ProjectBranchSelector } from '@renderer/lib/components/project-branch-selector';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal, type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ComboboxTrigger, ComboboxValue } from '@renderer/lib/ui/combobox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import { DialogClose } from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Textarea } from '@renderer/lib/ui/textarea';
import { log } from '@renderer/utils/logger';
import { resolveInitialBaseBranch } from './base-branch';

export type CreatePrModalArgs = {
  nameWithOwner: string;
  branchName: string;
  draft: boolean;
  workspaceId: string;
};

type Props = BaseModalProps<void> & CreatePrModalArgs;

export const CreatePrModal = observer(function CreatePrModal({
  nameWithOwner,
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

  const hasGitHubRemote = Boolean(nameWithOwner);
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
        repo?.configuredRemote ?? 'origin'
      );
      if (!pushResult.success) {
        log.error('Failed to push branch:', pushResult.error);
        return;
      }

      const result = await rpc.pullRequests.createPullRequest({
        nameWithOwner,
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
    if (!title.trim() || !nameWithOwner || !selectedBase?.branch) return;

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
    <>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-sm font-medium">
          {draft ? 'Create Draft PR' : 'Create Pull Request'}
        </span>
        <DialogClose render={<Button variant="ghost" size="icon-sm" />}>
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogClose>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {!hasGitHubRemote && (
          <p className="text-sm text-muted-foreground">
            No GitHub remote detected. Configure a GitHub remote to create pull requests.
          </p>
        )}
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
        <Input
          placeholder="PR title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!hasGitHubRemote}
        />
        <Textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={1}
          disabled={!hasGitHubRemote}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border p-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <ConfirmButton
          size="sm"
          onClick={() => void handleCreate()}
          disabled={!hasGitHubRemote || !selectedBase?.branch || !title.trim() || isCreating}
        >
          {isCreating ? 'Creating...' : draft ? 'Create Draft' : 'Create PR'}
        </ConfirmButton>
      </div>
    </>
  );
});
