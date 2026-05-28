import { observer } from 'mobx-react-lite';
import { PullRequestView } from '@renderer/features/projects/components/pr-view/pr-view';
import { SettingsPanel } from '@renderer/features/projects/components/settings-view/settings-panel';
import { TaskList } from '@renderer/features/projects/components/task-view/task-list';
import { WorkspacesView } from '@renderer/features/projects/components/workspaces-view/workspaces-view';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import type { ProjectView } from '@renderer/features/projects/stores/project-view';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';

const projectViewItems: Array<{ id: ProjectView; label: string }> = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'pull-request', label: 'Pull Requests' },
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'settings', label: 'Settings' },
];

function ProjectViewNav({
  activeView,
  onChange,
}: {
  activeView: ProjectView;
  onChange: (view: ProjectView) => void;
}) {
  return (
    <div className="py-10">
      <nav className="flex min-h-0 w-52 flex-col gap-0.5 overflow-y-auto" aria-label="Project">
        {projectViewItems.map((item) => {
          const isActive = item.id === activeView;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
                isActive &&
                  'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
              )}
            >
              <span className="truncate text-left">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export const ActiveProject = observer(function ActiveProject() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = asMounted(getProjectStore(projectId));

  if (!store) return null;

  const activeView = store.view.activeView;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1060px] flex-col gap-6 px-8">
        <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] gap-8 overflow-hidden">
          <ProjectViewNav
            activeView={activeView}
            onChange={(view) => store.view.setProjectView(view)}
          />
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col px-1 py-10">
              {activeView === 'tasks' && <TaskList />}
              {activeView === 'pull-request' && <PullRequestView />}
              {activeView === 'workspaces' && <WorkspacesView />}
              {activeView === 'settings' && <SettingsPanel />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
