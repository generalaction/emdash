import { observer } from 'mobx-react-lite';
import { PullRequestView } from '@renderer/features/projects/components/pr-view/pr-view';
import { SettingsPanel } from '@renderer/features/projects/components/settings-view/settings-panel';
import { TaskList } from '@renderer/features/projects/components/task-view/task-list';
import {
  asMounted,
  getProjectStore,
  isNonGitProject,
} from '@renderer/features/projects/stores/project-selectors';
import { useParams } from '@renderer/lib/layout/navigation-provider';

export const ActiveProject = observer(function ActiveProject() {
  const {
    params: { projectId },
  } = useParams('project');
  const projectStore = getProjectStore(projectId);
  const store = asMounted(projectStore);

  if (!store) return null;

  const isNonGit = isNonGitProject(projectStore);
  const activeView = store.view.activeView;

  return (
    <>
      {activeView === 'tasks' && <TaskList />}
      {activeView === 'pull-request' && !isNonGit && <PullRequestView />}
      {activeView === 'settings' && <SettingsPanel />}
    </>
  );
});
