import { getPillTabId, PillTabs, type PillTab } from '@emdash/ui/react/patterns';
import { GitPullRequest, ListTodo, PanelsTopLeft, Settings as SettingsIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  asAvailableProject,
  getProjectStore,
  getProjectViewStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { PullRequestView } from '@core/features/projects/browser/components/pr-view/pr-view';
import { SettingsPanel } from '@core/features/projects/browser/components/settings-view/settings-panel';
import { TaskList } from '@core/features/projects/browser/components/task-view/task-list';
import { ProjectWorkspacesView } from '@core/features/projects/browser/components/workspaces-view/project-workspaces-view';
import type { ProjectView } from '@core/features/projects/browser/stores/project-view';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useCurrentViewParams } from '@core/primitives/navigation/browser/navigation-hooks';
import { cn } from '@core/primitives/styling/browser/cn';

const PROJECT_SECTION_PANEL_ID = 'project-section-panel';

const projectViewItems: readonly PillTab<ProjectView>[] = [
  { value: 'tasks', label: 'Tasks', icon: <ListTodo className="size-3.5" /> },
  {
    value: 'pull-request',
    label: 'Pull Requests',
    icon: <GitPullRequest className="size-3.5" />,
  },
  {
    value: 'workspaces',
    label: 'Workspaces',
    icon: <PanelsTopLeft className="size-3.5" />,
  },
  { value: 'settings', label: 'Settings', icon: <SettingsIcon className="size-3.5" /> },
];

export const ActiveProject = observer(function ActiveProject() {
  const {
    params: { projectId },
  } = useCurrentViewParams(projectViewDef);
  const context = asAvailableProject(getProjectStore(projectId));
  const view = getProjectViewStore(projectId);

  if (!context || !view) return null;

  const activeView = view.activeView;
  const virtualizedSection = activeView === 'tasks' || activeView === 'pull-request';
  return (
    <div className="flex min-h-0 w-full flex-col gap-6">
      <PillTabs
        items={projectViewItems}
        value={activeView}
        onValueChange={(nextView) => view.setProjectView(nextView)}
        ariaLabel="Project sections"
        panelId={PROJECT_SECTION_PANEL_ID}
        labelVisibility="active-only"
      />
      <section
        role="tabpanel"
        id={PROJECT_SECTION_PANEL_ID}
        aria-labelledby={getPillTabId(PROJECT_SECTION_PANEL_ID, activeView)}
        className={cn(
          'mx-auto flex w-full max-w-4xl flex-col px-1',
          virtualizedSection ? 'h-[calc(100vh-16rem)] min-h-96' : 'min-h-[calc(100vh-16rem)]'
        )}
      >
        {activeView === 'tasks' && <TaskList />}
        {activeView === 'pull-request' && <PullRequestView />}
        {activeView === 'workspaces' && <ProjectWorkspacesView projectId={projectId} />}
        {activeView === 'settings' && <SettingsPanel />}
      </section>
    </div>
  );
});
