import { observer } from 'mobx-react-lite';
import { ProjectSettingsForm } from '@renderer/features/projects/components/settings-view/project-settings-form';
import { getProjectSettingsStore } from '@renderer/features/projects/stores/project-selectors';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Spinner } from '@renderer/lib/ui/spinner';

export const SettingsPanel = observer(function SettingsPanel() {
  const {
    params: { projectId },
  } = useParams('project');
  const store = getProjectSettingsStore(projectId);
  const settings = store?.settings;
  const writeTargets = store?.writeTargetsData.data;
  const overrideState = store?.overrideStateData.data;

  if (!store || !settings || !writeTargets || !overrideState) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <ProjectSettingsForm
      key={projectId}
      projectId={projectId}
      initial={settings}
      writeTargets={writeTargets}
      overrideState={overrideState}
      onSuccess={() => {}}
      save={(s) => store.save(s)}
      writeConfigToRepo={(request) => store.writeConfigToRepo(request)}
    />
  );
});
