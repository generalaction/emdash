import { Spinner } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { ProjectSettingsForm } from '@core/features/projects/browser/components/settings-view/project-settings-form';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { useCurrentViewParams } from '@core/primitives/navigation/browser/navigation-hooks';

export const SettingsPanel = observer(function SettingsPanel() {
  const {
    params: { projectId },
  } = useCurrentViewParams(projectViewDef);
  const mounted = asMounted(getProjectStore(projectId));
  const store = getProjectSettingsStore(projectId);
  const settings = store?.settings;
  const storedGitSettings = store?.storedGitSettings;
  const worktreeRootContext = store?.worktreeRootContext;
  const writeTargets = store?.writeTargets;
  const overrideState = store?.overrideState;
  const configMigrations = store?.configMigrations;

  if (
    !mounted ||
    !store ||
    !settings ||
    !storedGitSettings ||
    !worktreeRootContext ||
    !writeTargets ||
    !overrideState ||
    !configMigrations
  ) {
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
      projectType={mounted.data.type}
      initial={settings}
      storedGitSettings={storedGitSettings}
      worktreeRootContext={worktreeRootContext}
      writeTargets={writeTargets}
      overrideState={overrideState}
      configMigrations={configMigrations}
      onSuccess={() => {}}
      save={(s) => store.save(s)}
      writeConfigToRepo={(request) => store.writeConfigToRepo(request)}
      migrateProjectConfig={(request) => store.migrateProjectConfig(request)}
    />
  );
});
