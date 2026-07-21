import { Collapsible } from '@emdash/ui/react/primitives';
import { FolderGit2Icon, GitBranchIcon } from 'lucide-react';
import type { ProjectWorkspace } from '@core/primitives/workspaces/api';
import type { MachineProjectWorkspaces } from '../use-machine-workspaces';

export function MachineWorkspacesByProject({
  groups,
  loading,
  error,
}: {
  groups: MachineProjectWorkspaces[];
  loading: boolean;
  error: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">Workspaces by Project</h3>
      {loading ? (
        <EmptyMessage>Loading workspaces…</EmptyMessage>
      ) : error ? (
        <EmptyMessage>Could not load workspaces.</EmptyMessage>
      ) : groups.length === 0 ? (
        <EmptyMessage>No projects use this machine.</EmptyMessage>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map(({ project, workspaces }) => (
            <Collapsible.Root key={project.id} defaultOpen>
              <div className="overflow-hidden rounded-md border border-border">
                <Collapsible.Trigger className="rounded-none px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <FolderGit2Icon className="size-4 shrink-0 text-foreground-muted" />
                    <span className="truncate text-sm">{project.name}</span>
                    <span className="text-xs text-foreground-passive tabular-nums">
                      {workspaces.length}
                    </span>
                  </span>
                </Collapsible.Trigger>
                <Collapsible.Panel>
                  <div className="border-t border-border px-3 py-1">
                    {workspaces.length === 0 ? (
                      <p className="py-2 text-xs text-foreground-passive">No workspaces</p>
                    ) : (
                      workspaces.map((workspace) => (
                        <WorkspaceRow key={workspace.id} workspace={workspace} />
                      ))
                    )}
                  </div>
                </Collapsible.Panel>
              </div>
            </Collapsible.Root>
          ))}
        </div>
      )}
    </section>
  );
}

function WorkspaceRow({ workspace }: { workspace: ProjectWorkspace }) {
  const root = workspace.kind === 'project-root';
  const label = workspaceLabel(workspace);

  return (
    <div className="flex min-w-0 items-start gap-2 py-2">
      {root ? (
        <FolderGit2Icon className="mt-0.5 size-3.5 shrink-0 text-foreground-muted" />
      ) : (
        <GitBranchIcon className="mt-0.5 size-3.5 shrink-0 text-foreground-muted" />
      )}
      <div className="min-w-0">
        <div className="truncate text-sm text-foreground">{label}</div>
        {workspace.path && (
          <div className="truncate text-xs text-foreground-passive">{workspace.path}</div>
        )}
      </div>
    </div>
  );
}

function EmptyMessage({ children }: { children: string }) {
  return (
    <p className="rounded-md border border-dashed border-border px-3 py-4 text-xs text-foreground-passive">
      {children}
    </p>
  );
}

function workspaceLabel(workspace: ProjectWorkspace): string {
  if (workspace.kind === 'project-root') return 'Repository root';
  if (workspace.taskName) return workspace.taskName;
  if (workspace.branchName) return workspace.branchName;
  return workspace.path?.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace.id;
}
