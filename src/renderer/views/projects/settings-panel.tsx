import { Spinner } from '@renderer/components/ui/spinner';
import { ProjectSettingsForm } from '@renderer/core/projects/components/project-settings-form';
import { useProjectSettings } from '@renderer/core/projects/use-project-settings';
import { useParams } from '@renderer/core/view/navigation-provider';

export function SettingsPanel() {
  const {
    params: { projectId },
  } = useParams('project');
  const { settings, isLoading, save, isSaving } = useProjectSettings(projectId);

  if (isLoading || !settings) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <ProjectSettingsForm
      projectId={projectId}
      initial={settings}
      onSuccess={() => {}}
      save={save}
      isSaving={isSaving}
    />
  );
}
