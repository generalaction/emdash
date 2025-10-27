import React from 'react';
import { GitBranch, Bot } from 'lucide-react';
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
  onDelete?: () => void | Promise<void>;
  showDelete?: boolean;
}

export const WorkspaceItem: React.FC<WorkspaceItemProps> = ({ workspace, onDelete, showDelete }) => {
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
        {isRunning || workspace.status === 'running' || workspace.agentId ? (
          <Spinner size="sm" className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <GitBranch className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        )}
        <span className="block truncate text-xs font-medium text-foreground">{workspace.name}</span>
        {workspace.agentId && <Bot className="h-3 w-3 flex-shrink-0 text-purple-500" />}
        {/* No left-side delete icon; only show next to status badge on the right */}
      </div>
      <div className="flex flex-shrink-0 items-center space-x-2">
        {!isLoading && (totalAdditions > 0 || totalDeletions > 0) ? (
          <ChangesBadge additions={totalAdditions} deletions={totalDeletions} />
        ) : pr ? (
          <span
            className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            title={`${pr.title || 'Pull Request'} (#${pr.number})`}
          >
            {pr.isDraft ? 'draft' : pr.state.toLowerCase()}
          </span>
        ) : null}
        {showDelete && onDelete ? (
          <WorkspaceDeleteButton
            workspaceName={workspace.name}
            onConfirm={async () => {
              try {
                setIsDeleting(true);
                await onDelete();
              } finally {
                setIsDeleting(false);
              }
            }}
            isDeleting={isDeleting}
            aria-label={`Delete workspace ${workspace.name}`}
            className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100"
          />
        ) : null}
      </div>
    </div>
  );
};
