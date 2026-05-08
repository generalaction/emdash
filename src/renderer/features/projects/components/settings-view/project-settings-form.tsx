import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import type { Remote } from '@shared/git';
import type {
  ProjectSettings,
  ProjectSettingsOverrideState,
  ProjectSettingsWriteTargetOption,
  ShareableProjectSettingsWriteField,
  WriteProjectConfigRequest,
} from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, type Result } from '@shared/result';
import {
  clearFormShareableFields,
  DEFAULT_WRITE_FIELDS,
  formToSettings,
  getAvailableWriteFields,
  normalizeShareableFieldValue,
  settingsToForm,
  SHAREABLE_FIELD_FORM_KEY,
  validateWorkspaceProviderCommands,
  type FormState,
  type WorkspaceProviderValidationErrors,
} from '@renderer/features/projects/components/settings-view/project-settings-form-model';
import { projectConfigTargetValue } from '@renderer/features/projects/components/settings-view/share-project-config-modal';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { useModalContext } from '@renderer/lib/modal/modal-provider';
import { FieldGroup } from '@renderer/lib/ui/field';
import { ProjectSettingsFooter, type ProjectSettingsSaveStatus } from './project-settings-footer';
import { BaseProjectSettingsSection } from './sections/base-project-settings-section';
import { ShareableSettingsSection } from './sections/shareable-project-settings-section';
import { WorkspaceProviderSettingsSection } from './sections/workspace-provider-settings-section';

export interface ProjectSettingsFormProps {
  projectId: string;
  initial: ProjectSettings;
  writeTargets: ProjectSettingsWriteTargetOption[];
  overrideState: ProjectSettingsOverrideState;
  onSuccess: () => void;
  save: (settings: ProjectSettings) => Promise<Result<void, UpdateProjectSettingsError>>;
  writeConfigToRepo: (
    request: WriteProjectConfigRequest
  ) => Promise<Result<void, UpdateProjectSettingsError>>;
}

const EMPTY_REMOTES: Remote[] = [];
const EMPTY_OVERRIDE_STATE: ProjectSettingsOverrideState = {
  preservePatterns: [],
  shellSetup: [],
  'scripts.setup': [],
  'scripts.run': [],
  'scripts.teardown': [],
};

export const ProjectSettingsForm = observer(function ProjectSettingsForm({
  projectId,
  initial,
  writeTargets,
  overrideState,
  onSuccess,
  save,
  writeConfigToRepo,
}: ProjectSettingsFormProps) {
  const { showModal } = useModalContext();
  const repo = getRepositoryStore(projectId);
  const remotes = repo?.remotes ?? EMPTY_REMOTES;
  const configuredRemote = repo?.configuredRemote.name ?? 'origin';

  const baseline = useMemo(
    () => settingsToForm(initial, configuredRemote, remotes),
    [initial, configuredRemote, remotes]
  );
  const [form, setForm] = useState<FormState>(baseline);
  const [savedForm, setSavedForm] = useState<FormState>(baseline);
  const [saveStatus, setSaveStatus] = useState<ProjectSettingsSaveStatus>('idle');
  const [shareStatus, setShareStatus] = useState<'idle' | 'shared'>('idle');
  const availableWriteFields = useMemo(() => getAvailableWriteFields(savedForm), [savedForm]);
  const defaultSelectedWriteFields = useMemo(
    () => availableWriteFields.filter((field) => DEFAULT_WRITE_FIELDS.includes(field)),
    [availableWriteFields]
  );
  const [worktreeDirectoryError, setWorktreeDirectoryError] = useState<string | null>(null);
  const [workspaceProviderErrors, setWorkspaceProviderErrors] =
    useState<WorkspaceProviderValidationErrors>({});
  const isWorkspaceProviderEnabled = useFeatureFlag('workspace-provider');

  const formSnapshot = useMemo(() => JSON.stringify(form), [form]);
  const savedSnapshot = useMemo(() => JSON.stringify(savedForm), [savedForm]);
  const dirty = formSnapshot !== savedSnapshot;

  const canShareConfig = availableWriteFields.length > 0 && writeTargets.length > 0;
  const shareDisabled = dirty;
  const initialWriteTarget = writeTargets[0]
    ? projectConfigTargetValue(writeTargets[0])
    : 'project:repository';
  const overrides = overrideState ?? EMPTY_OVERRIDE_STATE;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaveStatus((current) => (current === 'idle' ? current : 'idle'));
    setShareStatus('idle');
    if (key === 'worktreeDirectory' && worktreeDirectoryError) {
      setWorktreeDirectoryError(null);
    }
    if (key === 'provisionCommand' || key === 'terminateCommand') {
      setWorkspaceProviderErrors({});
    }
  }

  function getOverrideSources(field: ShareableProjectSettingsWriteField) {
    const formValue = normalizeShareableFieldValue(field, form[SHAREABLE_FIELD_FORM_KEY[field]]);
    if (!formValue) return [];
    return (overrides[field] ?? []).filter(
      (source) => normalizeShareableFieldValue(field, source.value) !== formValue
    );
  }

  async function handleSave() {
    const formAtSubmit = {
      ...form,
      provisionCommand: form.provisionCommand.trim(),
      terminateCommand: form.terminateCommand.trim(),
    };
    const nextWorkspaceProviderErrors = validateWorkspaceProviderCommands(formAtSubmit);
    if (Object.values(nextWorkspaceProviderErrors).some(Boolean)) {
      setWorkspaceProviderErrors(nextWorkspaceProviderErrors);
      setSaveStatus('idle');
      return;
    }

    setSaveStatus('saving');

    const result = await save(formToSettings(formAtSubmit)).catch(() => err({ type: 'error' }));

    if (result.success) {
      setWorktreeDirectoryError(null);
      setForm(formAtSubmit);
      setSavedForm(formAtSubmit);
      setSaveStatus('saved');
      onSuccess();
      return;
    }

    if (result.error.type === 'invalid-worktree-directory') {
      setWorktreeDirectoryError('Invalid worktree directory');
      setSaveStatus('idle');
      return;
    }

    setWorktreeDirectoryError(null);
    setSaveStatus('error');
  }

  function openShareConfigModal() {
    if (!canShareConfig || shareDisabled) return;
    showModal('shareProjectConfigModal', {
      availableFields: availableWriteFields,
      defaultFields: defaultSelectedWriteFields,
      initialTarget: initialWriteTarget,
      targets: writeTargets,
      writeConfigToRepo,
      onSuccess: ({ fields }) => {
        setForm((current) => clearFormShareableFields(current, fields));
        setSavedForm((current) => clearFormShareableFields(current, fields));
        setShareStatus('shared');
        onSuccess();
      },
    });
  }

  function handleUndo() {
    setForm(savedForm);
    setWorktreeDirectoryError(null);
    setWorkspaceProviderErrors({});
    if (saveStatus === 'error') setSaveStatus('idle');
  }

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
            form={form}
            remotes={remotes}
            worktreeDirectoryError={worktreeDirectoryError}
            update={update}
          />
          <ShareableSettingsSection
            form={form}
            update={update}
            getOverrideSources={getOverrideSources}
          />
          <WorkspaceProviderSettingsSection
            enabled={isWorkspaceProviderEnabled}
            form={form}
            errors={workspaceProviderErrors}
            update={update}
          />
        </FieldGroup>
      </div>
      <ProjectSettingsFooter
        dirty={dirty}
        saveStatus={saveStatus}
        shareStatus={shareStatus}
        canShareConfig={canShareConfig}
        shareDisabled={shareDisabled}
        onShare={openShareConfigModal}
        onUndo={handleUndo}
        onSave={() => void handleSave()}
      />
    </div>
  );
});
