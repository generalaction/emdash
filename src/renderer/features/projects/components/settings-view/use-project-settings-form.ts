import { useCallback, useMemo, useState } from 'react';
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
import { useModalContext } from '@renderer/lib/modal/modal-provider';
import type { ProjectSettingsSaveStatus } from './project-settings-footer';
import {
  areFormStatesEqual,
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
} from './project-settings-form-model';
import { projectConfigTargetValue } from './share-project-config-modal';

type ProjectSettingsShareStatus = 'idle' | 'shared';

type UseProjectSettingsFormArgs = {
  initial: ProjectSettings;
  configuredRemote: string;
  remotes: Remote[];
  writeTargets: ProjectSettingsWriteTargetOption[];
  overrideState: ProjectSettingsOverrideState;
  onSuccess: () => void;
  save: (settings: ProjectSettings) => Promise<Result<void, UpdateProjectSettingsError>>;
  writeConfigToRepo: (
    request: WriteProjectConfigRequest
  ) => Promise<Result<void, UpdateProjectSettingsError>>;
};

const EMPTY_OVERRIDE_STATE: ProjectSettingsOverrideState = {
  preservePatterns: [],
  shellSetup: [],
  'scripts.setup': [],
  'scripts.run': [],
  'scripts.teardown': [],
};

export function useProjectSettingsForm({
  initial,
  configuredRemote,
  remotes,
  writeTargets,
  overrideState,
  onSuccess,
  save,
  writeConfigToRepo,
}: UseProjectSettingsFormArgs) {
  const { showModal } = useModalContext();
  const baseline = useMemo(
    () => settingsToForm(initial, configuredRemote, remotes),
    [initial, configuredRemote, remotes]
  );
  const [form, setForm] = useState<FormState>(baseline);
  const [savedForm, setSavedForm] = useState<FormState>(baseline);
  const [saveStatus, setSaveStatus] = useState<ProjectSettingsSaveStatus>('idle');
  const [shareStatus, setShareStatus] = useState<ProjectSettingsShareStatus>('idle');
  const [worktreeDirectoryError, setWorktreeDirectoryError] = useState<string | null>(null);
  const [workspaceProviderErrors, setWorkspaceProviderErrors] =
    useState<WorkspaceProviderValidationErrors>({});

  const availableWriteFields = useMemo(() => getAvailableWriteFields(savedForm), [savedForm]);
  const defaultSelectedWriteFields = useMemo(
    () => availableWriteFields.filter((field) => DEFAULT_WRITE_FIELDS.includes(field)),
    [availableWriteFields]
  );
  const dirty = !areFormStatesEqual(form, savedForm);
  const canShareConfig = availableWriteFields.length > 0 && writeTargets.length > 0;
  const shareDisabled = dirty;
  const initialWriteTarget = writeTargets[0]
    ? projectConfigTargetValue(writeTargets[0])
    : 'project:repository';
  const overrides = overrideState ?? EMPTY_OVERRIDE_STATE;

  const update = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
      setSaveStatus((current) => (current === 'idle' ? current : 'idle'));
      setShareStatus('idle');
      if (key === 'worktreeDirectory' && worktreeDirectoryError) {
        setWorktreeDirectoryError(null);
      }
      if (key === 'provisionCommand' || key === 'terminateCommand') {
        setWorkspaceProviderErrors({});
      }
    },
    [worktreeDirectoryError]
  );

  const getOverrideSources = useCallback(
    (field: ShareableProjectSettingsWriteField) => {
      const formValue = normalizeShareableFieldValue(field, form[SHAREABLE_FIELD_FORM_KEY[field]]);
      if (!formValue) return [];
      return (overrides[field] ?? []).filter(
        (source) => normalizeShareableFieldValue(field, source.value) !== formValue
      );
    },
    [form, overrides]
  );

  const handleSave = useCallback(async () => {
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
  }, [form, onSuccess, save]);

  const openShareConfigModal = useCallback(() => {
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
  }, [
    availableWriteFields,
    canShareConfig,
    defaultSelectedWriteFields,
    initialWriteTarget,
    onSuccess,
    shareDisabled,
    showModal,
    writeConfigToRepo,
    writeTargets,
  ]);

  const handleUndo = useCallback(() => {
    setForm(savedForm);
    setWorktreeDirectoryError(null);
    setWorkspaceProviderErrors({});
    if (saveStatus === 'error') setSaveStatus('idle');
  }, [savedForm, saveStatus]);

  return {
    form,
    dirty,
    saveStatus,
    shareStatus,
    canShareConfig,
    shareDisabled,
    worktreeDirectoryError,
    workspaceProviderErrors,
    update,
    getOverrideSources,
    handleSave,
    openShareConfigModal,
    handleUndo,
  };
}
