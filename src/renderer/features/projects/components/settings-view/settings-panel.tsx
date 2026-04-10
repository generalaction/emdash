import { ProjectSettingsForm } from '@renderer/features/projects/components/settings-view/project-settings-form';
import { useProjectSettings } from '@renderer/features/projects/use-project-settings';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Spinner } from '@renderer/lib/ui/spinner';

export function SettingsPanel() {
  const {
    params: { projectId },
  } = useParams('project');
  const { settings, isLoading, save } = useProjectSettings(projectId);

  if (isLoading || !settings) {
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
      onSuccess={() => {}}
      save={save}
    />
  );
}
