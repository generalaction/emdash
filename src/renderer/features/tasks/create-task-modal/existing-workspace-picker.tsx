import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronsUpDown, FolderGit2, GitBranch } from 'lucide-react';
import { useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@renderer/lib/ui/combobox';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { cn } from '@renderer/utils/utils';
import type { ProjectWorkspace } from '@shared/core/workspaces/project-workspace';

function workspaceLabel(ws: ProjectWorkspace): string {
  return ws.kind === 'project-root' ? 'Repository root' : (ws.branchName ?? ws.path ?? ws.id);
}

function WorkspaceItemContent({ ws }: { ws: ProjectWorkspace }) {
  const isRoot = ws.kind === 'project-root';
  const label = workspaceLabel(ws);
  const hasDiff = ws.linesAdded != null || ws.linesDeleted != null;

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className={cn('shrink-0 flex items-center gap-1.5')}>
        {isRoot ? <FolderGit2 className="size-3.5" /> : <GitBranch className="size-3.5" />}
        <span className="truncate text-sm leading-none">{label}</span>
        {hasDiff && (
          <span className="ml-2 text-xs text-foreground-muted">
            {ws.linesAdded != null && (
              <span className="text-foreground-diff-added">+{ws.linesAdded}</span>
            )}
            {ws.linesDeleted != null && (
              <span className="ml-1 text-foreground-diff-deleted">−{ws.linesDeleted}</span>
            )}
          </span>
        )}
        {/**
         * Linked tasks count show a Link icon and the number of linked tasks also add a tooltip saying 'Linked tasks'
         */}
      </span>
      <span className="truncate text-left text-xs leading-snug text-foreground-muted">
        {ws.path}
      </span>
    </span>
  );
}
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
        return workspaceLabel(ws).toLowerCase().includes(q) || ws.path?.toLowerCase().includes(q);
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
      <p className="text-xs text-foreground-muted">
        No existing workspaces found for this project.
      </p>
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
      <ComboboxTrigger className="data-popup-open:border-ring flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2 text-sm transition-colors outline-none hover:bg-background-2">
        {selected ? (
          <WorkspaceItemContent ws={selected} />
        ) : (
          <span className="text-foreground-muted">Select a workspace…</span>
        )}
        <ChevronsUpDown className="size-4 shrink-0 text-foreground-passive" />
      </ComboboxTrigger>
      <ComboboxContent>
        <ComboboxInput
          value={query}
          onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
          placeholder="Search workspaces…"
          showTrigger={false}
        />
        <ComboboxList className="max-h-52 overflow-y-auto p-1!">
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
          {filtered.length === 0 && (
            <EmptyState label="No workspaces found" className="border-none bg-transparent" />
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export function useProjectWorkspaces(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projectWorkspaces', projectId],
    queryFn: () => rpc.tasks.getProjectWorkspaces(projectId!),
    enabled: !!projectId,
    refetchOnWindowFocus: false,
  });
}
