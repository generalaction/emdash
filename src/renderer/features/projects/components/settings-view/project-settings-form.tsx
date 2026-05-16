import { observer } from 'mobx-react-lite';
import type { Remote } from '@shared/git';
import type {
  MigrateProjectConfigRequest,
  MigrateProjectConfigResult,
  ProjectConfigMigration,
  ProjectSettings,
  ProjectSettingsOverrideState,
  ProjectSettingsPage,
  ProjectSettingsWriteTargetOption,
  WriteProjectConfigRequest,
} from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import type { Result } from '@shared/result';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { FieldGroup } from '@renderer/lib/ui/field';
import { ProjectSettingsFooter } from './project-settings-footer';
import { BaseProjectSettingsSection } from './sections/base-project-settings-section';
import { ShareableSettingsSection } from './sections/shareable-project-settings-section';
import { WorkspaceProviderSettingsSection } from './sections/workspace-provider-settings-section';
import { useProjectSettingsForm } from './use-project-settings-form';

export interface ProjectSettingsFormProps {
  projectId: string;
  initial: ProjectSettings;
  defaults: ProjectSettingsPage['defaults'];
  writeTargets: ProjectSettingsWriteTargetOption[];
  overrideState: ProjectSettingsOverrideState;
  configMigrations: ProjectConfigMigration[];
  onSuccess: () => void;
  save: (settings: ProjectSettings) => Promise<Result<ProjectSettings, UpdateProjectSettingsError>>;
  writeConfigToRepo: (
    request: WriteProjectConfigRequest
  ) => Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>>;
  migrateProjectConfig: (
    request: MigrateProjectConfigRequest
  ) => Promise<Result<MigrateProjectConfigResult, UpdateProjectSettingsError>>;
}

const EMPTY_REMOTES: Remote[] = [];

export const ProjectSettingsForm = observer(function ProjectSettingsForm({
  projectId,
  initial,
  defaults,
  writeTargets,
  overrideState,
  configMigrations,
  onSuccess,
  save,
  writeConfigToRepo,
  migrateProjectConfig,
}: ProjectSettingsFormProps) {
  const repo = getRepositoryStore(projectId);
  const remotes = repo?.remotes ?? EMPTY_REMOTES;
  const baseRemote = repo?.baseRemote.name ?? 'origin';
  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');
  const formModel = useProjectSettingsForm({
    initial,
    baseRemote,
    remotes,
    writeTargets,
    overrideState,
    configMigrations,
    onSuccess,
    save,
    writeConfigToRepo,
    migrateProjectConfig,
  });

  return (
    <div className="flex flex-col max-w-3xl mx-auto w-full h-full overflow-hidden">
      <h1 className="text-lg font-medium pt-10 pb-5 px-10">Project Settings</h1>
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden px-10 py-2"
        style={{ scrollbarWidth: 'none' }}
      >
        <FieldGroup>
          <BaseProjectSettingsSection
            projectId={projectId}
            form={formModel.form}
            defaultWorktreeDirectory={defaults.worktreeDirectory}
            remotes={remotes}
            worktreeDirectoryError={formModel.worktreeDirectoryError}
            update={formModel.update}
          />
          <WorkspaceProviderSettingsSection
            enabled={isWorkspaceProviderEnabled}
            form={formModel.form}
            errors={formModel.workspaceProviderErrors}
            update={formModel.update}
          />
          <ShareableSettingsSection
            form={formModel.form}
            update={formModel.update}
            getOverrideSources={formModel.getOverrideSources}
            configMigrations={formModel.configMigrations}
            importDisabled={formModel.importDisabled}
            openImportConfigModal={formModel.openImportConfigModal}
          />
        </FieldGroup>
      </div>
      <ProjectSettingsFooter
        dirty={formModel.dirty}
        saveStatus={formModel.saveStatus}
        canShareConfig={formModel.canShareConfig}
        shareDisabled={formModel.shareDisabled}
        onShare={formModel.openShareConfigModal}
        onUndo={formModel.handleUndo}
        onSave={() => void formModel.handleSave()}
      />
    </div>
  );
});
