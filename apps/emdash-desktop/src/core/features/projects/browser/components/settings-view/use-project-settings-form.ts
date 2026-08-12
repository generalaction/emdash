import type { GitRemote } from '@emdash/core/runtimes/git/api';
import { err, type Result } from '@emdash/shared';
import { useToast } from '@emdash/ui/react/primitives';
import { useCallback, useMemo, useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import {
  type MigrateProjectConfigRequest,
  type ProjectConfigMigration,
  type ShareableProjectSettingsWriteField,
  type WriteProjectConfigRequest,
} from '@core/primitives/project-settings/api';
import type { UpdateProjectSettingsError } from '@core/primitives/projects/api';
import type {
  MigrateProjectConfigResult,
  ProjectSettingsDomainPatch,
  ProjectSettingsDomains,
  ProjectSettingsPage,
} from '../../../api/project-settings-page';
import type { ProjectSettingsSaveStatus } from './project-settings-footer';
import {
  areFormStatesEqual,
  formToProjectSettingsDomainPatch,
  getAvailableWriteFields,
  normalizeShareableFieldValue,
  projectSettingsDomainsToForm,
  shareableFieldFormValue,
  type FileHandlingFormState,
  type FormFieldPath,
  type FormSection,
  type FormState,
  type FormUpdate,
  type GitIdentityFormState,
  type LifecycleFormState,
  type PlacementFormState,
} from './project-settings-form-model';
import { projectConfigTargetValue } from './share-project-config-modal';
import { DEFAULT_WRITE_FIELDS } from './shareable-project-settings-fields';

type UseProjectSettingsFormArgs = {
  domains: ProjectSettingsDomains;
  remotes: GitRemote[];
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
};

type FormSnapshot = {
  baseline: FormState;
  form: FormState;
  savedForm: FormState;
  touchedFields: ReadonlySet<FormFieldPath>;
};

function resolveFormSnapshot(snapshot: FormSnapshot, baseline: FormState): FormSnapshot {
  if (snapshot.baseline === baseline) return snapshot;
  if (!areFormStatesEqual(snapshot.form, snapshot.savedForm)) return snapshot;
  return { baseline, form: baseline, savedForm: baseline, touchedFields: new Set() };
}

export function useProjectSettingsForm({
  domains,
  remotes,
  configMigrations,
  onSuccess,
  save,
  writeConfigToRepo,
  migrateProjectConfig,
}: UseProjectSettingsFormArgs) {
  const openShareProjectConfigModal = useOpenModal('shareProjectConfigModal');
  const openProjectConfigImportModal = useOpenModal('projectConfigImportModal');
  const { toast } = useToast();
  const baseline = useMemo(
    () => projectSettingsDomainsToForm(domains, remotes),
    [domains, remotes]
  );
  const [formSnapshot, setFormSnapshot] = useState<FormSnapshot>({
    baseline,
    form: baseline,
    savedForm: baseline,
    touchedFields: new Set(),
  });
  const [saveStatus, setSaveStatus] = useState<ProjectSettingsSaveStatus>('idle');
  const [worktreeDirectoryError, setWorktreeDirectoryError] = useState<string | null>(null);

  const resolvedSnapshot = resolveFormSnapshot(formSnapshot, baseline);
  const { form, savedForm } = resolvedSnapshot;
  const writeTargets = domains.lifecycle.writeTargets;
  const availableWriteFields = getAvailableWriteFields(savedForm);
  const defaultSelectedWriteFields = availableWriteFields.filter((field) =>
    DEFAULT_WRITE_FIELDS.includes(field)
  );
  const dirty = !areFormStatesEqual(form, savedForm);
  const canShareConfig = availableWriteFields.length > 0 && writeTargets.length > 0;
  const shareDisabled = dirty;
  const canImportConfig = configMigrations.length > 0;
  const importDisabled = dirty;
  const initialWriteTarget = writeTargets[0]
    ? projectConfigTargetValue(writeTargets[0])
    : 'project:repository';
  const baselineResynced = resolvedSnapshot !== formSnapshot && areFormStatesEqual(form, savedForm);
  const visibleWorktreeDirectoryError = baselineResynced ? null : worktreeDirectoryError;

  const updateSection = useCallback(
    <S extends FormSection, K extends keyof FormState[S]>(
      section: S,
      key: K,
      value: FormState[S][K]
    ) => {
      setFormSnapshot({
        ...resolvedSnapshot,
        form: {
          ...form,
          [section]: { ...form[section], [key]: value },
        },
        touchedFields: new Set([
          ...resolvedSnapshot.touchedFields,
          `${section}.${String(key)}` as FormFieldPath,
        ]),
      });
      setSaveStatus((current) => (current === 'idle' ? current : 'idle'));
      if (section === 'placement' && key === 'worktreeDirectory' && visibleWorktreeDirectoryError) {
        setWorktreeDirectoryError(null);
      }
    },
    [form, resolvedSnapshot, visibleWorktreeDirectoryError]
  );
  const updateLifecycle = useCallback<FormUpdate<LifecycleFormState>>(
    (key, value) => updateSection('lifecycle', key, value),
    [updateSection]
  );
  const updateFileHandling = useCallback<FormUpdate<FileHandlingFormState>>(
    (key, value) => updateSection('fileHandling', key, value),
    [updateSection]
  );
  const updateGitIdentity = useCallback<FormUpdate<GitIdentityFormState>>(
    (key, value) => updateSection('gitIdentity', key, value),
    [updateSection]
  );
  const updatePlacement = useCallback<FormUpdate<PlacementFormState>>(
    (key, value) => updateSection('placement', key, value),
    [updateSection]
  );

  const getOverrideSources = useCallback(
    (field: ShareableProjectSettingsWriteField) => {
      const formValue = normalizeShareableFieldValue(field, shareableFieldFormValue(form, field));
      if (!formValue) return [];
      const sources =
        field === 'preservePatterns'
          ? domains.fileHandling.sources.map((source) => ({
              ...source,
              value: source.value.join('\n'),
            }))
          : domains.lifecycle.sources[
              field.slice('scripts.'.length) as 'prepare' | 'setup' | 'run' | 'teardown'
            ];
      return sources.filter(
        (source) => normalizeShareableFieldValue(field, source.value) !== formValue
      );
    },
    [domains, form]
  );

  const handleSave = useCallback(async () => {
    setSaveStatus('saving');

    const result = await save(
      formToProjectSettingsDomainPatch(form, resolvedSnapshot.touchedFields)
    ).catch(() => err({ type: 'error' }));

    if (result.success) {
      const canonicalForm = projectSettingsDomainsToForm(result.data.domains, remotes);
      setWorktreeDirectoryError(null);
      setFormSnapshot({
        baseline: canonicalForm,
        form: canonicalForm,
        savedForm: canonicalForm,
        touchedFields: new Set(),
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
  }, [form, onSuccess, remotes, resolvedSnapshot.touchedFields, save]);

  const openShareConfigModal = useCallback(() => {
    if (!canShareConfig || shareDisabled) return;
    void openShareProjectConfigModal({
      availableFields: availableWriteFields,
      defaultFields: defaultSelectedWriteFields,
      initialTarget: initialWriteTarget,
      targets: writeTargets,
      writeConfigToRepo,
    }).then((outcome) => {
      if (!outcome.success) return;
      const nextForm = projectSettingsDomainsToForm(outcome.data.page.domains, remotes);
      setFormSnapshot({
        baseline: nextForm,
        form: nextForm,
        savedForm: nextForm,
        touchedFields: new Set(),
      });
      toast('Team config shared', { description: '.emdash.json was written successfully.' });
      onSuccess();
    });
  }, [
    availableWriteFields,
    canShareConfig,
    defaultSelectedWriteFields,
    initialWriteTarget,
    onSuccess,
    openShareProjectConfigModal,
    remotes,
    shareDisabled,
    toast,
    writeConfigToRepo,
    writeTargets,
  ]);

  const openImportConfigModal = useCallback(() => {
    if (!canImportConfig || importDisabled) return;
    void openProjectConfigImportModal({
      migrations: configMigrations,
      migrateProjectConfig,
    }).then((outcome) => {
      if (!outcome.success) return;
      const { page, migration } = outcome.data;
      const nextForm = projectSettingsDomainsToForm(page.domains, remotes);
      setFormSnapshot({
        baseline: nextForm,
        form: nextForm,
        savedForm: nextForm,
        touchedFields: new Set(),
      });
      toast(`${migration.label} config imported`, {
        description: `${migration.files.join(', ')} was imported successfully.`,
      });
      onSuccess();
    });
  }, [
    canImportConfig,
    configMigrations,
    importDisabled,
    migrateProjectConfig,
    onSuccess,
    openProjectConfigImportModal,
    remotes,
    toast,
  ]);

  const handleUndo = useCallback(() => {
    setFormSnapshot({
      ...resolvedSnapshot,
      form: savedForm,
      touchedFields: new Set(),
    });
    setWorktreeDirectoryError(null);
    if (saveStatus === 'error') setSaveStatus('idle');
  }, [resolvedSnapshot, savedForm, saveStatus]);

  return {
    form,
    dirty,
    saveStatus,
    canShareConfig,
    shareDisabled,
    canImportConfig,
    importDisabled,
    configMigrations,
    worktreeDirectoryError: visibleWorktreeDirectoryError,
    updateLifecycle,
    updateFileHandling,
    updateGitIdentity,
    updatePlacement,
    getOverrideSources,
    handleSave,
    openShareConfigModal,
    openImportConfigModal,
    handleUndo,
  };
}
