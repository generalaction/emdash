import { useQuery } from '@tanstack/react-query';
import { ChevronDown, FolderGit2, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import { cn } from '@renderer/utils/utils';
import type { ProjectWorkspace } from '@shared/core/workspaces/project-workspace';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspaceLabel(ws: ProjectWorkspace): string {
  return ws.kind === 'project-root' ? 'Repository root' : (ws.branchName ?? ws.path ?? ws.id);
}

function workspaceSub(ws: ProjectWorkspace): string {
  return ws.kind === 'project-root' ? (ws.path ?? '') : (ws.taskName ?? ws.path ?? '');
}

// ---------------------------------------------------------------------------
// Item content shared between trigger and list
// ---------------------------------------------------------------------------

function WorkspaceItemContent({ ws, muted = false }: { ws: ProjectWorkspace; muted?: boolean }) {
  const isRoot = ws.kind === 'project-root';
  const label = workspaceLabel(ws);
  const sub = workspaceSub(ws);
  const hasDiff = ws.linesAdded != null || ws.linesDeleted != null;

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className={cn('shrink-0', muted ? 'text-foreground-passive' : 'text-foreground-muted')}>
        {isRoot ? <FolderGit2 className="size-4" /> : <GitBranch className="size-4" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium leading-none">{label}</span>
        {sub && <span className="truncate text-xs leading-snug text-foreground-muted">{sub}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {ws.isLive && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
            live
          </span>
        )}
        {hasDiff && (
          <span className="text-xs text-foreground-muted">
            {ws.linesAdded != null && (
              <span className="text-emerald-500">+{ws.linesAdded}</span>
            )}
            {ws.linesDeleted != null && (
              <span className="ml-1 text-red-500">−{ws.linesDeleted}</span>
            )}
          </span>
        )}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ExistingWorkspacePickerProps {
  projectId: string | undefined;
  selectedWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
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

  const [query, setQuery] = useState('');

  const selected = workspaces.find((ws) => ws.id === selectedWorkspaceId) ?? null;

  const filtered = query
    ? workspaces.filter((ws) => {
        const q = query.toLowerCase();
        return (
          workspaceLabel(ws).toLowerCase().includes(q) ||
          workspaceSub(ws).toLowerCase().includes(q)
        );
      })
    : workspaces;

  if (isLoading) {
    return (
      <div className="flex h-9 items-center justify-center text-xs text-foreground-muted">
        Loading workspaces…
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <p className="text-xs text-foreground-muted">No existing workspaces found for this project.</p>
    );
  }

  return (
    <Combobox
      value={selected}
      onValueChange={(ws: ProjectWorkspace | null) => {
        if (ws) onSelect(ws.id);
      }}
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
      isItemEqualToValue={(a: ProjectWorkspace, b: ProjectWorkspace) => a.id === b.id}
    >
      <ComboboxTrigger className="data-popup-open:border-ring flex h-9 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2.5 text-sm outline-none transition-colors hover:bg-background-1">
        {selected ? (
          <WorkspaceItemContent ws={selected} />
        ) : (
          <span className="text-foreground-muted">Select a workspace…</span>
        )}
        <ChevronDown className="size-3.5 shrink-0 text-foreground-passive" />
      </ComboboxTrigger>

      <ComboboxContent>
        <ComboboxInput
          value={query}
          onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
          placeholder="Search workspaces…"
          showTrigger={false}
        />
        <ComboboxList>
          {filtered.map((ws) => (
            <ComboboxItem
              key={ws.id}
              value={ws}
              showCheck={false}
              className="items-start py-2 pr-3"
            >
              <WorkspaceItemContent ws={ws} />
            </ComboboxItem>
          ))}
          <ComboboxEmpty>No matching workspaces</ComboboxEmpty>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// ---------------------------------------------------------------------------
// Standalone query hook used by parent components
// ---------------------------------------------------------------------------

/**
 * Returns a list of existing workspaces for a project.
 * Used by parent components to know whether the "existing" preset should be available.
 */
export function useProjectWorkspaces(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projectWorkspaces', projectId],
    queryFn: () => rpc.tasks.getProjectWorkspaces(projectId!),
    enabled: !!projectId,
    refetchOnWindowFocus: false,
  });
}
