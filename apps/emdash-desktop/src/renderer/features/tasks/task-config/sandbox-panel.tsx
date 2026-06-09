import type { WorkspacePanelProps } from './new-worktree-panel';

export function SandboxPanel(_: WorkspacePanelProps) {
  return (
    <p className="text-xs text-foreground-muted">
      A remote sandbox will be provisioned using your workspace provider script when this task
      starts.
    </p>
  );
}
