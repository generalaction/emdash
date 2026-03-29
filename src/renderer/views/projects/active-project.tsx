import { observer } from 'mobx-react-lite';
import { PullRequestView } from '@renderer/components/projects/pr-view';
import { isMountedProject } from '@renderer/core/stores/project';
import { getProjectStore, mountedProjectData } from '@renderer/core/stores/project-selectors';
import { useParams } from '@renderer/core/view/navigation-provider';
import { SettingsPanel } from './settings-panel';
import { TaskList } from './task-list';

export const ActiveProject = observer(function ActiveProject() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = getProjectStore(projectId);
  const project = mountedProjectData(store);

  if (!project || !store || !isMountedProject(store)) return null;

  const activeView = store.view.activeView;

  return (
    <>
      {activeView === 'tasks' && <TaskList />}
      {activeView === 'pull-request' && <PullRequestView />}
      {activeView === 'settings' && <SettingsPanel />}
      {(activeView === 'repository' || activeView === 'commits') && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          Coming soon
        </div>
      )}
    </>
  );
});
