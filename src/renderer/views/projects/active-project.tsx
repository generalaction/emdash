import { observer } from 'mobx-react-lite';
import { PullRequestView } from '@renderer/components/projects/pr-view';
import { asMounted, getProjectStore } from '@renderer/core/stores/project-selectors';
import { useParams } from '@renderer/core/view/navigation-provider';
import { SettingsPanel } from './settings-panel';
import { TaskList } from './task-list';

export const ActiveProject = observer(function ActiveProject() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = asMounted(getProjectStore(projectId));

  if (!store) return null;

  const activeView = store.view.activeView;

  return (
    <>
      {activeView === 'tasks' && <TaskList />}
      {activeView === 'pull-request' && <PullRequestView />}
      {activeView === 'settings' && <SettingsPanel />}
    </>
  );
});
