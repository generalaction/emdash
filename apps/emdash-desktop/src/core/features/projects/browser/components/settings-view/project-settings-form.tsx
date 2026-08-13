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
import type { Project } from '@core/primitives/projects/api';
import type { ProjectHostObservation } from '../../../api/host-observation';
import type {
  MigrateProjectConfigResult,
  ProjectSettingsDomainPatch,
  ProjectSettingsDomains,
  ProjectSettingsError,
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
  hostActionReason: string | null;
  hostObservationKind: ProjectHostObservation<unknown>['kind'];
  onSuccess: () => void;
  save: (
    patch: ProjectSettingsDomainPatch
  ) => Promise<Result<ProjectSettingsPage, ProjectSettingsError>>;
  writeConfigToRepo: (
    request: WriteProjectConfigRequest
  ) => Promise<Result<ProjectSettingsPage, ProjectSettingsError>>;
  migrateProjectConfig: (
    request: MigrateProjectConfigRequest
  ) => Promise<Result<MigrateProjectConfigResult, ProjectSettingsError>>;
}

const EMPTY_REMOTES: GitRemote[] = [];

export const ProjectSettingsForm = observer(function ProjectSettingsForm({
  projectId,
  projectType,
  domains,
  configMigrations,
  hostActionReason,
  hostObservationKind,
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
        {hostObservationKind === 'stale' ? (
          <p role="status" className="pb-2 text-xs text-foreground-muted">
            Host-derived settings may be out of date while this Project is unavailable.
          </p>
        ) : null}
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
            hostActionReason={hostActionReason}
            hostObservationKind={hostObservationKind}
          />
          {hostObservationKind === 'unavailable' ? (
            <div
              role="status"
              className="border-t border-border py-6 text-sm text-foreground-muted"
            >
              Repository-backed settings are unavailable until this Project’s Machine can be
              observed.
            </div>
          ) : (
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
              hostActionReason={hostActionReason}
            />
          )}
        </Field.Group>
      </div>
      <ProjectSettingsFooter
        dirty={formModel.dirty}
        saveStatus={formModel.saveStatus}
        canShareConfig={formModel.canShareConfig}
        shareDisabled={formModel.shareDisabled}
        hostActionReason={hostActionReason}
        onShare={formModel.openShareConfigModal}
        onUndo={formModel.handleUndo}
        onSave={() => void formModel.handleSave()}
      />
    </div>
  );
});
