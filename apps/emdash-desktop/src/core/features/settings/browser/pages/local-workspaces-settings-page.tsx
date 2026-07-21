import { PageLayout } from '@emdash/ui/react/patterns';

export function LocalWorkspacesSettingsPage() {
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="Workspaces (local)"
        description="Manage local workspace settings and defaults."
      />
      <p className="text-sm text-foreground-muted">Local workspace settings are coming soon.</p>
    </div>
  );
}
