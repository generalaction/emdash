import { Button, Spinner } from '@emdash/ui/react/primitives';
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
  const domains = store?.domains;
  const configMigrations = store?.configMigrations;

  if ((!domains || !configMigrations) && store?.pageData.error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Could not load project settings</p>
          <p className="text-sm text-foreground-muted">{store.pageData.error}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={store.pageData.loading}
          onClick={() => void store.load()}
        >
          {store.pageData.loading ? 'Retrying…' : 'Retry'}
        </Button>
      </div>
    );
  }

  if (!mounted || !store || !domains || !configMigrations) {
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
      domains={domains}
      configMigrations={configMigrations}
      onSuccess={() => {}}
      save={(s) => store.save(s)}
      writeConfigToRepo={(request) => store.writeConfigToRepo(request)}
      migrateProjectConfig={(request) => store.migrateProjectConfig(request)}
    />
  );
});
