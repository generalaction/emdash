import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { ConfirmButton } from '@renderer/components/ui/confirm-button';
import { DialogClose } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Textarea } from '@renderer/components/ui/textarea';
import { rpc } from '@renderer/core/ipc';
import { useShowModal, type BaseModalProps } from '@renderer/core/modal/modal-provider';
import { log } from '@renderer/lib/logger';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';

export type CreatePrModalArgs = {
  nameWithOwner: string;
  branchName: string;
  draft: boolean;
};

type Props = BaseModalProps<void> & CreatePrModalArgs;

export function CreatePrModal({ nameWithOwner, branchName, draft, onSuccess, onClose }: Props) {
  const { projectId, taskId } = useTaskViewContext();
  const queryClient = useQueryClient();
  const showConfirm = useShowModal('confirmActionModal');
  const [title, setTitle] = useState(branchName);
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const hasGitHubRemote = Boolean(nameWithOwner);

  const doPushAndCreate = async (capturedTitle: string, capturedDescription: string) => {
    setIsCreating(true);
    try {
      const pushResult = await rpc.git.push(projectId, taskId);
      if (!pushResult.success) {
        log.error('Failed to push branch:', pushResult.error);
        return;
      }

      const defaultBranchResult = await rpc.git.getDefaultBranch(projectId, taskId);
      const base = defaultBranchResult.success ? defaultBranchResult.data.name : 'main';

      const result = await rpc.pullRequests.createPullRequest({
        nameWithOwner,
        head: branchName,
        base,
        title: capturedTitle,
        body: capturedDescription || undefined,
        draft,
      });

      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: ['pullRequests', 'task', projectId, taskId],
        });
        void queryClient.invalidateQueries({ queryKey: ['branch-status', projectId, taskId] });
        onSuccess();
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreate = async () => {
    if (!title.trim() || !nameWithOwner) return;

    const capturedTitle = title.trim();
    const capturedDescription = description.trim();

    const statusResult = await rpc.git.getBranchStatus(projectId, taskId);
    const isPushed = statusResult.success && Boolean(statusResult.data.upstream);

    if (!isPushed) {
      showConfirm({
        title: 'Push branch to remote?',
        description: `"${branchName}" hasn't been pushed yet. It needs to be pushed before opening a pull request.`,
        confirmLabel: 'Push & Create PR',
        variant: 'default',
        onSuccess: () => {
          void doPushAndCreate(capturedTitle, capturedDescription);
        },
      });
      return;
    }

    void doPushAndCreate(capturedTitle, capturedDescription);
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
            No GitHub remote detected. Configure a GitHub remote named{' '}
            <code className="font-mono text-xs">origin</code> to create pull requests.
          </p>
        )}
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
          disabled={!hasGitHubRemote || !title.trim() || isCreating}
        >
          {isCreating ? 'Creating...' : draft ? 'Create Draft' : 'Create PR'}
        </ConfirmButton>
      </div>
    </>
  );
}
