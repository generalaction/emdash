import React from 'react';
import { GitBranch, ArrowUpRight } from 'lucide-react';
import WorkspaceDeleteButton from './WorkspaceDeleteButton';
import { useWorkspaceChanges } from '../hooks/useWorkspaceChanges';
import { ChangesBadge } from './WorkspaceChanges';
import { Spinner } from './ui/spinner';
import { usePrStatus } from '../hooks/usePrStatus';
import { useWorkspaceBusy } from '../hooks/useWorkspaceBusy';

interface Workspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  agentId?: string;
}

interface WorkspaceItemProps {
  workspace: Workspace;
  onDelete?: () => void | Promise<void | boolean>;
  showDelete?: boolean;
}

export const WorkspaceItem: React.FC<WorkspaceItemProps> = ({
  workspace,
  onDelete,
  showDelete,
}) => {
  const { totalAdditions, totalDeletions, isLoading } = useWorkspaceChanges(
    workspace.path,
    workspace.id
  );
  const { pr } = usePrStatus(workspace.path);
  const isRunning = useWorkspaceBusy(workspace.id);

  const [isDeleting, setIsDeleting] = React.useState(false);

  return (
    <div className="flex min-w-0 items-center justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
        {isRunning || workspace.status === 'running' ? (
          <Spinner size="sm" className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <GitBranch className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        )}
        <span className="block truncate text-xs font-medium text-foreground">{workspace.name}</span>
      </div>
      <div className="relative flex flex-shrink-0 items-center pl-6">
        {showDelete && onDelete ? (
          <WorkspaceDeleteButton
            workspaceName={workspace.name}
            workspaceId={workspace.id}
            workspacePath={workspace.path}
            onConfirm={async () => {
              try {
                setIsDeleting(true);
                await onDelete();
              } finally {
                setIsDeleting(false);
              }
            }}
            isDeleting={isDeleting}
            aria-label={`Delete Task ${workspace.name}`}
            className={`absolute left-0 inline-flex h-5 w-5 items-center justify-center rounded p-0.5 text-muted-foreground transition-opacity duration-150 hover:bg-muted focus:opacity-100 focus-visible:opacity-100 ${
              isDeleting ? 'opacity-100' : 'opacity-0 group-hover/workspace:opacity-100'
            }`}
          />
        ) : null}
        <div aria-hidden={isLoading ? 'true' : 'false'}>
          {!isLoading && (totalAdditions > 0 || totalDeletions > 0) ? (
            <ChangesBadge additions={totalAdditions} deletions={totalDeletions} />
          ) : pr ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (pr.url) window.electronAPI.openExternal(pr.url);
              }}
              className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title={`${pr.title || 'Pull Request'} (#${pr.number})`}
            >
              {pr.isDraft
                ? 'Draft'
                : String(pr.state).toUpperCase() === 'OPEN'
                  ? 'View PR'
                  : `PR ${String(pr.state).charAt(0).toUpperCase() + String(pr.state).slice(1).toLowerCase()}`}
              <ArrowUpRight className="size-3" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
