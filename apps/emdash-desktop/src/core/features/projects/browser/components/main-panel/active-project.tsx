import { SelectableCard } from '@emdash/ui/react/primitives';
import {
  GitPullRequest,
  ListTodo,
  PanelsTopLeft,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef, type KeyboardEvent } from 'react';
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

const projectViewItems: Array<{ id: ProjectView; label: string; icon: LucideIcon }> = [
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'pull-request', label: 'Pull Requests', icon: GitPullRequest },
  { id: 'workspaces', label: 'Workspaces', icon: PanelsTopLeft },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function ProjectSectionTabs({
  activeView,
  onChange,
}: {
  activeView: ProjectView;
  onChange: (view: ProjectView) => void;
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activate = (index: number) => {
    const item = projectViewItems[index];
    if (!item) return;
    onChange(item.id);
    tabRefs.current[index]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % projectViewItems.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + projectViewItems.length) % projectViewItems.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = projectViewItems.length - 1;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    activate(nextIndex);
  };

  return (
    <div role="tablist" aria-label="Project sections" className="grid grid-cols-4 gap-2">
      {projectViewItems.map((item, index) => {
        const isActive = item.id === activeView;
        const Icon = item.icon;
        return (
          <SelectableCard
            key={item.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            role="tab"
            id={`project-section-tab-${item.id}`}
            aria-controls="project-section-panel"
            selected={isActive}
            tabIndex={isActive ? 0 : -1}
            padding="2"
            borderRadius="md"
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="flex w-full items-center justify-center gap-2">
              <Icon aria-hidden="true" className="size-3.5" />
              <span className="text-sm">{item.label}</span>
            </span>
          </SelectableCard>
        );
      })}
    </div>
  );
}

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
      <ProjectSectionTabs
        activeView={activeView}
        onChange={(nextView) => view.setProjectView(nextView)}
      />
      <section
        role="tabpanel"
        id="project-section-panel"
        aria-labelledby={`project-section-tab-${activeView}`}
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
