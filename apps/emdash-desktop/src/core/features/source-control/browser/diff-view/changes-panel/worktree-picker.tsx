import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { Button, DropdownMenu } from '@emdash/ui/react/primitives';
import { useMutation } from '@tanstack/react-query';
import { Check, ChevronDown, GitBranch, RotateCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { DiffViewStore } from '@core/features/source-control/api/browser/diff-view/stores/diff-view-store';
import { getWorkspaceRegistryWireClient } from '@core/features/workspaces/api/browser/client';
import { projectWorkspaceOpenInTaskDisabledReason } from '@core/primitives/workspaces/api';

export const WorktreePicker = observer(function WorktreePicker({ view }: { view: DiffViewStore }) {
  const refresh = useMutation({
    mutationFn: async () => {
      const client = await getWorkspaceRegistryWireClient();
      const root = view.worktrees.find((row) => row.kind === 'root');
      const result = await client.refresh({
        host: LOCAL_HOST_REF,
        ...(root?.workspaceId ? { workspaceId: root.workspaceId } : {}),
      });
      if (!result.success) throw new Error(`Could not refresh worktrees: ${result.error.type}`);
    },
  });
  const selected = view.worktrees.find((row) => row.workspaceId === view.selectedWorkspaceId);
  const label = selected?.branch ?? view.gitCheckout.headDisplay ?? 'Detached HEAD';

  return (
    <div className="shrink-0 border-b border-border p-2">
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (open && !refresh.isPending) refresh.mutate();
        }}
      >
        <DropdownMenu.Trigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              aria-label={`Select worktree: ${label}`}
              title={view.workspace.path}
            />
          }
        >
          <GitBranch className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          {!view.readOnly && <span className="text-xs text-foreground-muted">Task worktree</span>}
          <ChevronDown className="size-3.5 shrink-0" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" className="max-w-[440px]">
          {view.worktreesLoading && (
            <DropdownMenu.Item disabled>Loading worktrees…</DropdownMenu.Item>
          )}
          {view.worktrees.map((row) => {
            const reason = projectWorkspaceOpenInTaskDisabledReason(row);
            return (
              <DropdownMenu.Item
                key={row.workspaceId}
                aria-current={row.workspaceId === view.selectedWorkspaceId ? 'true' : undefined}
                disabled={!!reason}
                title={reason ?? row.path}
                onClick={() => {
                  if (row.workspaceId) view.selectWorkspace(row.workspaceId);
                }}
              >
                <Check
                  className={`size-3.5 shrink-0 ${row.workspaceId === view.selectedWorkspaceId ? '' : 'invisible'}`}
                />
                <span className="flex min-w-0 flex-col">
                  <span>
                    {row.branch ?? 'Detached HEAD'}
                    {row.workspaceId === view.taskWorkspaceId && ' · Task worktree'}
                  </span>
                  <span className="truncate text-xs text-foreground-muted">{row.path}</span>
                </span>
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator />
          <DropdownMenu.Item disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            <RotateCw className="size-3.5" />
            {refresh.isPending ? 'Refreshing…' : 'Refresh worktrees'}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      {view.readOnly && <p className="mt-1 text-xs text-foreground-muted">Read-only inspection</p>}
      {view.inspectionNotice && (
        <p role="status" className="mt-1 text-xs">
          {view.inspectionNotice}
        </p>
      )}
      {(refresh.error || view.worktreesError) && (
        <p role="alert" className="mt-1 text-xs text-foreground-destructive">
          {refresh.error?.message ?? view.worktreesError}
        </p>
      )}
    </div>
  );
});
