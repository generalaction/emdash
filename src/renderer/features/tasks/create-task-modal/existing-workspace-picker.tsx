import { useQuery } from '@tanstack/react-query';
import { FolderGit2, GitBranch } from 'lucide-react';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import type { ProjectWorkspace } from '@shared/core/workspaces/project-workspace';

interface ExistingWorkspacePickerProps {
  projectId: string | undefined;
  selectedWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
}

function WorkspaceRow({
  ws,
  selected,
  onSelect,
}: {
  ws: ProjectWorkspace;
  selected: boolean;
  onSelect: () => void;
}) {
  const isRoot = ws.kind === 'project-root';
  const label = isRoot ? 'Repository root' : (ws.branchName ?? ws.path ?? ws.id);
  const sub = isRoot ? (ws.path ?? '') : (ws.taskName ?? ws.path ?? '');
  const hasDiff = ws.linesAdded != null || ws.linesDeleted != null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border p-2.5 text-left text-sm transition-colors',
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-background hover:bg-background-1'
      )}
    >
      <span className="mt-0.5 shrink-0 text-foreground-muted">
        {isRoot ? <FolderGit2 className="size-4" /> : <GitBranch className="size-4" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate leading-none font-medium">{label}</span>
        {sub && <span className="truncate text-xs text-foreground-muted">{sub}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {ws.isLive && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
            live
          </span>
        )}
        {hasDiff && (
          <span className="text-xs text-foreground-muted">
            {ws.linesAdded != null && <span className="text-emerald-500">+{ws.linesAdded}</span>}
            {ws.linesDeleted != null && (
              <span className="ml-1 text-red-500">−{ws.linesDeleted}</span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}

export function ExistingWorkspacePicker({
  projectId,
  selectedWorkspaceId,
  onSelect,
}: ExistingWorkspacePickerProps) {
  const { data: workspaces = [], isLoading } = useQuery({
    queryKey: ['projectWorkspaces', projectId],
    queryFn: () => rpc.tasks.getProjectWorkspaces(projectId!),
    enabled: !!projectId,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex h-12 items-center justify-center text-xs text-foreground-muted">
        Loading workspaces…
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <p className="text-xs text-foreground-muted">
        No existing workspaces found for this project.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {workspaces.map((ws) => (
        <WorkspaceRow
          key={ws.id}
          ws={ws}
          selected={ws.id === selectedWorkspaceId}
          onSelect={() => onSelect(ws.id)}
        />
      ))}
    </div>
  );
}

/**
 * Returns a list of existing workspaces for a project, using the same query.
 * Used by parent components to know whether the "existing" mode should be available.
 */
export function useProjectWorkspaces(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projectWorkspaces', projectId],
    queryFn: () => rpc.tasks.getProjectWorkspaces(projectId!),
    enabled: !!projectId,
    refetchOnWindowFocus: false,
  });
}
