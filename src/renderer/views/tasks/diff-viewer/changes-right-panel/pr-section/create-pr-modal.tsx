import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { DialogClose, DialogContent } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Textarea } from '@renderer/components/ui/textarea';
import { rpc } from '@renderer/core/ipc';
import type { BaseModalProps } from '@renderer/core/modal/modal-provider';
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
  const [title, setTitle] = useState(branchName);
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setIsCreating(true);
    try {
      const pushResult = await rpc.git.push(projectId, taskId);
      if (!pushResult.success) {
        console.error('Failed to push branch:', pushResult.error);
        return;
      }

      const defaultBranchResult = await rpc.git.getDefaultBranch(projectId, taskId);
      const base = defaultBranchResult.success ? defaultBranchResult.data.name : 'main';

      const result = await rpc.pullRequests.createPullRequest({
        nameWithOwner,
        head: branchName,
        base,
        title: title.trim(),
        body: description.trim() || undefined,
        draft,
      });

      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['pull-requests', nameWithOwner] });
        queryClient.invalidateQueries({ queryKey: ['branch-status', projectId, taskId] });
        onSuccess();
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <DialogContent
      className="flex max-h-[70vh] flex-col gap-0 p-0 sm:max-w-2xl"
      showCloseButton={false}
    >
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
        <Input placeholder="PR title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={1}
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border p-3">
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleCreate} disabled={!title.trim() || isCreating}>
          {isCreating ? 'Creating...' : draft ? 'Create Draft' : 'Create PR'}
        </Button>
      </div>
    </DialogContent>
  );
}
