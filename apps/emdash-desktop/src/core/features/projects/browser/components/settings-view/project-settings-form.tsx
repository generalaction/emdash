import type { GitRemote } from '@emdash/core/runtimes/git/api';
import type { Result } from '@emdash/shared';
import { Field } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import type {
  MigrateProjectConfigRequest,
  ProjectConfigMigration,
  WriteProjectConfigRequest,
} from '@core/primitives/project-settings/api';
import type { Project, UpdateProjectSettingsError } from '@core/primitives/projects/api';
import type {
  MigrateProjectConfigResult,
  ProjectSettingsDomainPatch,
  ProjectSettingsDomains,
  ProjectSettingsPage,
} from '../../../api/project-settings-page';
import { ProjectSettingsFooter } from './project-settings-footer';
import { BaseProjectSettingsSection } from './sections/base-project-settings-section';
import { ShareableSettingsSection } from './sections/shareable-project-settings-section';
import { useProjectSettingsForm } from './use-project-settings-form';

export interface ProjectSettingsFormProps {
  projectId: string;
  projectType: Project['type'];
  domains: ProjectSettingsDomains;
  configMigrations: ProjectConfigMigration[];
  onSuccess: () => void;
  save: (
    patch: ProjectSettingsDomainPatch
  ) => Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>>;
  writeConfigToRepo: (
    request: WriteProjectConfigRequest
  ) => Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>>;
  migrateProjectConfig: (
    request: MigrateProjectConfigRequest
  ) => Promise<Result<MigrateProjectConfigResult, UpdateProjectSettingsError>>;
}

const EMPTY_REMOTES: GitRemote[] = [];

export const ProjectSettingsForm = observer(function ProjectSettingsForm({
  projectId,
  projectType,
  domains,
  configMigrations,
  onSuccess,
  save,
  writeConfigToRepo,
  migrateProjectConfig,
}: ProjectSettingsFormProps) {
  const repo = getGitRepositoryStore(projectId);
  const remotes = repo?.remotes ?? EMPTY_REMOTES;
  const formModel = useProjectSettingsForm({
    domains,
    remotes,
    configMigrations,
    onSuccess,
    save,
    writeConfigToRepo,
    migrateProjectConfig,
  });

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div
        className="flex-1 overflow-x-hidden overflow-y-auto px-0.5 py-2"
        style={{ scrollbarWidth: 'none' }}
      >
        <Field.Group>
          <BaseProjectSettingsSection
            projectId={projectId}
            gitIdentityForm={formModel.form.gitIdentity}
            placementForm={formModel.form.placement}
            placement={domains.placement}
            projectType={projectType}
            remotes={remotes}
            worktreeDirectoryError={formModel.worktreeDirectoryError}
            updateGitIdentity={formModel.updateGitIdentity}
            updatePlacement={formModel.updatePlacement}
          />
          <ShareableSettingsSection
            lifecycleForm={formModel.form.lifecycle}
            fileHandlingForm={formModel.form.fileHandling}
            updateLifecycle={formModel.updateLifecycle}
            updateFileHandling={formModel.updateFileHandling}
            getOverrideSources={formModel.getOverrideSources}
            lifecycle={domains.lifecycle}
            fileHandling={domains.fileHandling}
            configMigrations={formModel.configMigrations}
            importDisabled={formModel.importDisabled}
            openImportConfigModal={formModel.openImportConfigModal}
          />
        </Field.Group>
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
