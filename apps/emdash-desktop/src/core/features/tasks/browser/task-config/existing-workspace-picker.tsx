import { EmptyState } from '@emdash/ui/react/components';
import { Combobox, Tooltip } from '@emdash/ui/react/primitives';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, FolderGit2, GitBranch, Link } from 'lucide-react';
import { useState } from 'react';
import { getTasksWireClient } from '@core/features/tasks/api/browser/client';
import { cn } from '@core/primitives/styling/browser/cn';
import type { ProjectWorkspace } from '@core/primitives/workspaces/api';

function workspaceLabel(ws: ProjectWorkspace): string {
  if (ws.kind === 'repository') return 'Repository root';
  if (ws.path) {
    const lastSegment = ws.path.split('/').at(-1);
    return lastSegment || (ws.branchName ?? ws.id);
  }
  return ws.branchName ?? ws.id;
}

function WorkspaceItemContent({ ws }: { ws: ProjectWorkspace }) {
  const isRoot = ws.kind === 'repository';
  const label = workspaceLabel(ws);
  const hasDiff = ws.linesAdded != null || ws.linesDeleted != null;

  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className={cn('shrink-0 flex items-center gap-1.5')}>
        {isRoot ? <FolderGit2 className="size-3.5" /> : <GitBranch className="size-3.5" />}
        <span className="truncate text-sm leading-none">{label}</span>
        {hasDiff && (
          <span className="ml-1 text-xs text-foreground-muted">
            {ws.linesAdded != null && (
              <span className="text-foreground-diff-added">+{ws.linesAdded}</span>
            )}
            {ws.linesDeleted != null && (
              <span className="ml-1 text-foreground-diff-deleted">−{ws.linesDeleted}</span>
            )}
          </span>
        )}
        {ws.linkedTaskCount > 0 && (
          <Tooltip.Provider>
            <Tooltip.Root>
              <Tooltip.Trigger className="ml-1 flex items-center gap-0.5 text-xs text-foreground-info">
                <Link className="size-3" />
                {ws.linkedTaskCount}
              </Tooltip.Trigger>
              <Tooltip.Content>
                {ws.linkedTaskCount === 1
                  ? '1 associated task'
                  : `${ws.linkedTaskCount} associated tasks`}
              </Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        )}
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
    queryFn: async () =>
      (await getTasksWireClient()).getProjectWorkspaces({ projectId: projectId! }),
    enabled: !!projectId,
    refetchOnWindowFocus: false,
  });

  const [query, setQuery] = useState('');

  const withPath = workspaces.filter((ws) => ws.path != null);

  const selected = withPath.find((ws) => ws.id === selectedWorkspaceId) ?? null;

  const filtered = query
    ? withPath.filter((ws) => {
        const q = query.toLowerCase();
        return workspaceLabel(ws).toLowerCase().includes(q) || ws.path?.toLowerCase().includes(q);
      })
    : withPath;

  if (isLoading) {
    return (
      <div className="flex h-9 items-center justify-center text-xs text-foreground-muted">
        Loading workspaces…
      </div>
    );
  }

  if (withPath.length === 0) {
    return (
      <p className="text-xs text-foreground-muted">
        No existing workspaces found for this project.
      </p>
    );
  }

  return (
    <Combobox.Root
      value={selected}
      onValueChange={(ws: ProjectWorkspace | null) => {
        if (ws) onSelect(ws.id);
      }}
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
      isItemEqualToValue={(a: ProjectWorkspace, b: ProjectWorkspace) => a.id === b.id}
    >
      <Combobox.Trigger className="data-popup-open:border-ring flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-2 text-sm transition-colors outline-none hover:bg-background-2">
        {selected ? (
          <WorkspaceItemContent ws={selected} />
        ) : (
          <span className="text-foreground-muted">Select a workspace…</span>
        )}
        <ChevronsUpDown className="size-4 shrink-0 text-foreground-passive" />
      </Combobox.Trigger>
      <Combobox.Content>
        <Combobox.Input
          value={query}
          onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
          placeholder="Search workspaces…"
          showTrigger={false}
        />
        <Combobox.List className="max-h-52 overflow-y-auto p-1!">
          {filtered.map((ws) => (
            <Combobox.Item
              key={ws.id}
              value={ws}
              showCheck={false}
              className="items-start py-2 pr-3"
            >
              <WorkspaceItemContent ws={ws} />
            </Combobox.Item>
          ))}
          {filtered.length === 0 && (
            <EmptyState label="No workspaces found" className="border-none bg-transparent" />
          )}
        </Combobox.List>
      </Combobox.Content>
    </Combobox.Root>
  );
}

export function useProjectWorkspaces(projectId: string | undefined) {
  return useQuery({
    queryKey: ['projectWorkspaces', projectId],
    queryFn: async () =>
      (await getTasksWireClient()).getProjectWorkspaces({ projectId: projectId! }),
    enabled: !!projectId,
    refetchOnWindowFocus: false,
  });
}
