import { useCallback, useMemo, useState } from 'react';
import type { Remote } from '@shared/git';
import {
  emptyProjectSettingsOverrideState,
  type ProjectSettings,
  type ProjectSettingsOverrideState,
  type ProjectSettingsPage,
  type ProjectSettingsWriteTargetOption,
  type ShareableProjectSettingsWriteField,
  type WriteProjectConfigRequest,
} from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, type Result } from '@shared/result';
import { useModalContext } from '@renderer/lib/modal/modal-provider';
import type { ProjectSettingsSaveStatus } from './project-settings-footer';
import {
  areFormStatesEqual,
  formToSettings,
  getAvailableWriteFields,
  normalizeShareableFieldValue,
  settingsToForm,
  validateWorkspaceProviderCommands,
  type FormState,
  type WorkspaceProviderValidationErrors,
} from './project-settings-form-model';
import { projectConfigTargetValue } from './share-project-config-modal';
import {
  DEFAULT_WRITE_FIELDS,
  SHAREABLE_FIELD_FORM_KEY,
} from './shareable-project-settings-fields';

type UseProjectSettingsFormArgs = {
  initial: ProjectSettings;
  configuredRemote: string;
  remotes: Remote[];
  writeTargets: ProjectSettingsWriteTargetOption[];
  overrideState: ProjectSettingsOverrideState;
  onSuccess: () => void;
  save: (settings: ProjectSettings) => Promise<Result<ProjectSettings, UpdateProjectSettingsError>>;
  writeConfigToRepo: (
    request: WriteProjectConfigRequest
  ) => Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>>;
};

type FormSnapshot = {
  baseline: FormState;
  form: FormState;
  savedForm: FormState;
};

function resolveFormSnapshot(snapshot: FormSnapshot, baseline: FormState): FormSnapshot {
  if (snapshot.baseline === baseline) return snapshot;
  if (!areFormStatesEqual(snapshot.form, snapshot.savedForm)) return snapshot;
  return { baseline, form: baseline, savedForm: baseline };
}

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
  const [formSnapshot, setFormSnapshot] = useState<FormSnapshot>({
    baseline,
    form: baseline,
    savedForm: baseline,
  });
  const [saveStatus, setSaveStatus] = useState<ProjectSettingsSaveStatus>('idle');
  const [worktreeDirectoryError, setWorktreeDirectoryError] = useState<string | null>(null);
  const [workspaceProviderErrors, setWorkspaceProviderErrors] =
    useState<WorkspaceProviderValidationErrors>({});

  const resolvedSnapshot = resolveFormSnapshot(formSnapshot, baseline);
  const { form, savedForm } = resolvedSnapshot;
  const availableWriteFields = getAvailableWriteFields(savedForm);
  const defaultSelectedWriteFields = availableWriteFields.filter((field) =>
    DEFAULT_WRITE_FIELDS.includes(field)
  );
  const dirty = !areFormStatesEqual(form, savedForm);
  const canShareConfig = availableWriteFields.length > 0 && writeTargets.length > 0;
  const shareDisabled = dirty;
  const initialWriteTarget = writeTargets[0]
    ? projectConfigTargetValue(writeTargets[0])
    : 'project:repository';
  const overrides = overrideState ?? emptyProjectSettingsOverrideState();
  const baselineResynced = resolvedSnapshot !== formSnapshot && areFormStatesEqual(form, savedForm);
  const visibleWorktreeDirectoryError = baselineResynced ? null : worktreeDirectoryError;
  const visibleWorkspaceProviderErrors = baselineResynced ? {} : workspaceProviderErrors;

  const update = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setFormSnapshot({
        ...resolvedSnapshot,
        form: { ...form, [key]: value },
      });
      setSaveStatus((current) => (current === 'idle' ? current : 'idle'));
      if (key === 'worktreeDirectory' && visibleWorktreeDirectoryError) {
        setWorktreeDirectoryError(null);
      }
      if (key === 'provisionCommand' || key === 'terminateCommand') {
        setWorkspaceProviderErrors({});
      }
    },
    [form, resolvedSnapshot, visibleWorktreeDirectoryError]
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
      const canonicalForm = settingsToForm(result.data, configuredRemote, remotes);
      setWorktreeDirectoryError(null);
      setFormSnapshot({
        baseline: canonicalForm,
        form: canonicalForm,
        savedForm: canonicalForm,
      });
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
  }, [configuredRemote, form, onSuccess, remotes, save]);

  const openShareConfigModal = useCallback(() => {
    if (!canShareConfig || shareDisabled) return;
    showModal('shareProjectConfigModal', {
      availableFields: availableWriteFields,
      defaultFields: defaultSelectedWriteFields,
      initialTarget: initialWriteTarget,
      targets: writeTargets,
      writeConfigToRepo,
      onSuccess: ({ page }) => {
        const nextForm = settingsToForm(page.settings, configuredRemote, remotes);
        setFormSnapshot({
          baseline: nextForm,
          form: nextForm,
          savedForm: nextForm,
        });
        onSuccess();
      },
    });
  }, [
    availableWriteFields,
    canShareConfig,
    configuredRemote,
    defaultSelectedWriteFields,
    initialWriteTarget,
    onSuccess,
    remotes,
    shareDisabled,
    showModal,
    writeConfigToRepo,
    writeTargets,
  ]);

  const handleUndo = useCallback(() => {
    setFormSnapshot({
      ...resolvedSnapshot,
      form: savedForm,
    });
    setWorktreeDirectoryError(null);
    setWorkspaceProviderErrors({});
    if (saveStatus === 'error') setSaveStatus('idle');
  }, [resolvedSnapshot, savedForm, saveStatus]);

  return {
    form,
    dirty,
    saveStatus,
    canShareConfig,
    shareDisabled,
    worktreeDirectoryError: visibleWorktreeDirectoryError,
    workspaceProviderErrors: visibleWorkspaceProviderErrors,
    update,
    getOverrideSources,
    handleSave,
    openShareConfigModal,
    handleUndo,
  };
}
