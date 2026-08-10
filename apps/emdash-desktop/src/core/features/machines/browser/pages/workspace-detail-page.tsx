import { WorkspaceDetailPage } from '@core/features/workspaces/contributions/browser/workspace-detail-page';
import type { SettingsPageDetailProps } from '@core/primitives/settings/api/page-contribution';

/** Local Workspaces tab detail: path is `[projectId]`. */
export function LocalWorkspaceDetailPage(props: SettingsPageDetailProps) {
  return <WorkspaceDetailPage scope={{ kind: 'local' }} connected {...props} />;
}
