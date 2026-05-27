import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { getTaskManagerStore } from '@renderer/features/tasks/stores/task-selectors';
import { workspaceRegistry } from '@renderer/features/tasks/stores/workspace-registry';
import { useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { Button } from '@renderer/lib/ui/button';

export const WorkspaceResolutionView = observer(function WorkspaceResolutionView() {
  const { projectId, taskId, workspaceId } = useTaskViewContext();
  const taskManager = getTaskManagerStore(projectId);
  const [busy, setBusy] = useState(false);

  const bs = workspaceId ? workspaceRegistry.bootstrapStateFor(projectId, workspaceId) : null;
  const resolution = bs?.kind === 'needs-resolution' ? bs.resolution : null;

  if (!taskManager || !resolution) {
    return null;
  }

  async function handle(action: 'adopt' | 'create' | 'cancel', candidatePath?: string) {
    if (busy || !taskManager) return;
    setBusy(true);
    try {
      await taskManager.continueProvision(taskId, action, candidatePath);
    } finally {
      setBusy(false);
    }
  }

  if (resolution.kind === 'branch_elsewhere') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <p className="font-mono text-sm font-medium">Workspace path has moved</p>
          <p className="font-mono text-xs text-foreground-muted">
            Branch <span className="font-semibold">{resolution.taskBranch}</span> was previously at:
          </p>
          <code className="bg-background-elevated rounded px-2 py-1 text-xs break-all">
            {resolution.previousPath}
          </code>
          <p className="font-mono text-xs text-foreground-muted">It is now checked out at:</p>
          <code className="bg-background-elevated rounded px-2 py-1 text-xs break-all">
            {resolution.candidatePath}
          </code>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="default"
              disabled={busy}
              onClick={() => void handle('adopt', resolution.candidatePath)}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Use existing location
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void handle('create')}
            >
              Create new worktree
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (resolution.kind === 'path_missing') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <p className="font-mono text-sm font-medium">Workspace path not found</p>
          <p className="font-mono text-xs text-foreground-muted">
            The workspace directory no longer exists:
          </p>
          <code className="bg-background-elevated rounded px-2 py-1 text-xs break-all">
            {resolution.previousPath}
          </code>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void handle('cancel')}
            >
              Cancel
            </Button>
            {resolution.taskBranch && (
              <Button
                size="sm"
                variant="default"
                disabled={busy}
                onClick={() => void handle('create')}
              >
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Create new worktree
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
});
