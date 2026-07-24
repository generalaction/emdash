import { observer } from 'mobx-react-lite';
import {
  asMounted,
  getProjectSettingsStore,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { ProjectSettingsForm } from '@core/features/projects/browser/components/settings-view/project-settings-form';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import { useCurrentViewParams } from '@renderer/lib/layout/navigation-provider';

export const SettingsPanel = observer(function SettingsPanel() {
  const {
    params: { projectId },
  } = useCurrentViewParams(projectViewDef);
  const mounted = asMounted(getProjectStore(projectId));
  const store = getProjectSettingsStore(projectId);
  const settings = store?.settings;
  const defaults = store?.defaults;
  const writeTargets = store?.writeTargets;
  const overrideState = store?.overrideState;
  const configMigrations = store?.configMigrations;

  if (
    !mounted ||
    !store ||
    !settings ||
    !defaults ||
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
      defaults={defaults}
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
