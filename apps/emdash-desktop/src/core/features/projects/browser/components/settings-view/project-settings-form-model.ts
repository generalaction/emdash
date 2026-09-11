import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import {
  DEFAULT_AGENT_GIT_CREDENTIALS,
  DEFAULT_WORKSPACE_PRESET,
} from '@core/primitives/project-settings/api';
import type {
  AgentGitCredentialsSetting,
  DefaultWorkspacePresetSetting,
  ShareableProjectSettingsWriteField,
  StoredDefaultBranch,
  StoredGithubAccount,
  StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';
import type {
  ProjectFileHandlingDomainSnapshot,
  ProjectEnvironmentDomainSnapshot,
  ProjectGitIdentityDomainSnapshot,
  ProjectLifecycleDomainSnapshot,
  ProjectPlacementDomainSnapshot,
  ProjectSettingsDomainPatch,
  ProjectSettingsDomains,
} from '../../../api/project-settings-page';
import {
  SHAREABLE_FIELD_DESCRIPTOR_BY_ID,
  SHAREABLE_FIELD_DESCRIPTORS,
} from './shareable-project-settings-fields';

export type LifecycleFormState = {
  autoRunSetupScriptOnTaskCreation: boolean | undefined;
  autoRunRunScriptOnTaskCreation: boolean | undefined;
  scriptPrepare: string;
  scriptSetup: string;
  scriptRun: string;
  scriptTeardown: string;
};

export type FileHandlingFormState = {
  preservePatterns: string;
};

export type EnvironmentVariableFormEntry = { key: string; value: string };

export type EnvironmentFormState = {
  variables: EnvironmentVariableFormEntry[];
};

export type GitIdentityFormState = {
  defaultBranch: GitBranchRef | null;
  baseRemote: string;
  pushRemote: string;
  githubAccount: StoredGithubAccount | undefined;
  agentGitCredentials: AgentGitCredentialsSetting;
};

export type PlacementFormState = {
  /** Undefined means inherit from the host/app placement layers. */
  tmux: boolean | undefined;
  worktreeDirectory: string;
  /** The built-in default is stored as absence; see `placementToPatch`. */
  defaultWorkspacePreset: DefaultWorkspacePresetSetting;
};

export type FormState = {
  lifecycle: LifecycleFormState;
  fileHandling: FileHandlingFormState;
  environment: EnvironmentFormState;
  gitIdentity: GitIdentityFormState;
  placement: PlacementFormState;
};

export type FormSection = keyof FormState;
export type FormFieldPath = {
  [S in FormSection]: `${S}.${Extract<keyof FormState[S], string>}`;
}[FormSection];
export type FormUpdate<T> = <K extends keyof T>(key: K, value: T[K]) => void;

function normalizeScript(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join('\n') : (value ?? '');
}

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function storedDefaultBranchToBranchRef(
  stored: StoredDefaultBranch | undefined,
  remotes: { name: string; url: string }[]
): GitBranchRef | null {
  if (!stored) return null;
  if (stored.remote === null) return { type: 'local', branch: stored.branch };
  const remote = remotes.find((candidate) => candidate.name === stored.remote) ?? {
    name: stored.remote,
    url: '',
  };
  return { type: 'remote', branch: stored.branch, remote };
}

function branchRefToStoredDefaultBranch(ref: GitBranchRef): StoredDefaultBranch {
  return ref.type === 'remote'
    ? { remote: ref.remote.name, branch: ref.branch }
    : { remote: null, branch: ref.branch };
}

export function lifecycleToForm(domain: ProjectLifecycleDomainSnapshot): LifecycleFormState {
  return {
    autoRunSetupScriptOnTaskCreation: domain.personal.autoRunSetup,
    autoRunRunScriptOnTaskCreation: domain.personal.autoRunRun,
    scriptPrepare: normalizeScript(domain.personal.scripts?.prepare),
    scriptSetup: normalizeScript(domain.personal.scripts?.setup),
    scriptRun: normalizeScript(domain.personal.scripts?.run),
    scriptTeardown: normalizeScript(domain.personal.scripts?.teardown),
  };
}

export function fileHandlingToForm(
  domain: ProjectFileHandlingDomainSnapshot
): FileHandlingFormState {
  return { preservePatterns: (domain.personal.preservePatterns ?? []).join('\n') };
}

export function environmentToForm(domain: ProjectEnvironmentDomainSnapshot): EnvironmentFormState {
  return {
    variables: Object.entries(domain.personal.env ?? {}).map(([key, value]) => ({ key, value })),
  };
}

export function gitIdentityToForm(
  domain: ProjectGitIdentityDomainSnapshot,
  remotes: { name: string; url: string }[]
): GitIdentityFormState {
  return {
    defaultBranch: storedDefaultBranchToBranchRef(domain.stored.defaultBranch, remotes),
    baseRemote: domain.stored.baseRemote ?? '',
    pushRemote: domain.stored.pushRemote ?? '',
    githubAccount: domain.stored.githubAccount,
    agentGitCredentials: domain.stored.agentGitCredentials ?? DEFAULT_AGENT_GIT_CREDENTIALS,
  };
}

export function placementToForm(domain: ProjectPlacementDomainSnapshot): PlacementFormState {
  return {
    tmux: domain.stored.tmux,
    worktreeDirectory: domain.stored.worktreeRoot ?? '',
    defaultWorkspacePreset: domain.stored.defaultWorkspacePreset ?? DEFAULT_WORKSPACE_PRESET,
  };
}

export function projectSettingsDomainsToForm(
  domains: ProjectSettingsDomains,
  remotes: { name: string; url: string }[]
): FormState {
  return {
    lifecycle: lifecycleToForm(domains.lifecycle),
    fileHandling: fileHandlingToForm(domains.fileHandling),
    environment: environmentToForm(domains.environment),
    gitIdentity: gitIdentityToForm(domains.gitIdentity, remotes),
    placement: placementToForm(domains.placement),
  };
}

function isTouched(
  touchedFields: ReadonlySet<FormFieldPath> | undefined,
  field: FormFieldPath
): boolean {
  return !touchedFields || touchedFields.has(field);
}

export function lifecycleToPatch(
  form: LifecycleFormState,
  touchedFields?: ReadonlySet<FormFieldPath>
): ProjectSettingsDomainPatch['lifecycle'] | undefined {
  const scripts: NonNullable<
    NonNullable<ProjectSettingsDomainPatch['lifecycle']>['personal']['scripts']
  > = {};
  const scriptFields = {
    prepare: ['scriptPrepare', form.scriptPrepare],
    setup: ['scriptSetup', form.scriptSetup],
    run: ['scriptRun', form.scriptRun],
    teardown: ['scriptTeardown', form.scriptTeardown],
  } as const;
  for (const [script, [field, value]] of Object.entries(scriptFields) as [
    keyof typeof scriptFields,
    (typeof scriptFields)[keyof typeof scriptFields],
  ][]) {
    if (!isTouched(touchedFields, `lifecycle.${field}`)) continue;
    scripts[script] = blankToUndefined(value) ?? null;
  }

  const personal: NonNullable<ProjectSettingsDomainPatch['lifecycle']>['personal'] = {};
  if (Object.keys(scripts).length > 0) personal.scripts = scripts;
  if (isTouched(touchedFields, 'lifecycle.autoRunSetupScriptOnTaskCreation')) {
    personal.autoRunSetup = form.autoRunSetupScriptOnTaskCreation ?? null;
  }
  if (isTouched(touchedFields, 'lifecycle.autoRunRunScriptOnTaskCreation')) {
    personal.autoRunRun = form.autoRunRunScriptOnTaskCreation ?? null;
  }
  return Object.keys(personal).length > 0 ? { personal } : undefined;
}

export function fileHandlingToPatch(
  form: FileHandlingFormState,
  touchedFields?: ReadonlySet<FormFieldPath>
): ProjectSettingsDomainPatch['fileHandling'] | undefined {
  if (!isTouched(touchedFields, 'fileHandling.preservePatterns')) return undefined;
  const preservePatterns = parsePreservePatterns(form.preservePatterns);
  return {
    personal: { preservePatterns: preservePatterns.length > 0 ? preservePatterns : null },
  };
}

export function environmentToPatch(
  form: EnvironmentFormState,
  touchedFields?: ReadonlySet<FormFieldPath>
): ProjectSettingsDomainPatch['environment'] | undefined {
  if (!isTouched(touchedFields, 'environment.variables')) return undefined;
  const env: Record<string, string> = {};
  for (const entry of form.variables) {
    const key = entry.key.trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = entry.value;
  }
  return { personal: { env: Object.keys(env).length > 0 ? env : null } };
}

export function gitIdentityToPatch(
  form: GitIdentityFormState,
  touchedFields?: ReadonlySet<FormFieldPath>
): ProjectSettingsDomainPatch['gitIdentity'] | undefined {
  const stored: NonNullable<ProjectSettingsDomainPatch['gitIdentity']>['stored'] = {};
  if (isTouched(touchedFields, 'gitIdentity.defaultBranch')) {
    stored.defaultBranch = form.defaultBranch
      ? branchRefToStoredDefaultBranch(form.defaultBranch)
      : null;
  }
  if (isTouched(touchedFields, 'gitIdentity.baseRemote')) {
    stored.baseRemote = blankToUndefined(form.baseRemote) ?? null;
  }
  if (isTouched(touchedFields, 'gitIdentity.pushRemote')) {
    const pushRemote =
      form.pushRemote.trim() && form.pushRemote.trim() !== form.baseRemote.trim()
        ? form.pushRemote.trim()
        : undefined;
    stored.pushRemote = pushRemote ?? null;
  }
  if (isTouched(touchedFields, 'gitIdentity.githubAccount')) {
    stored.githubAccount = form.githubAccount ?? null;
  }
  if (isTouched(touchedFields, 'gitIdentity.agentGitCredentials')) {
    stored.agentGitCredentials =
      form.agentGitCredentials === DEFAULT_AGENT_GIT_CREDENTIALS ? null : form.agentGitCredentials;
  }
  return Object.keys(stored).length > 0 ? { stored } : undefined;
}

export function placementToPatch(
  form: PlacementFormState,
  touchedFields?: ReadonlySet<FormFieldPath>
): ProjectSettingsDomainPatch['placement'] | undefined {
  const stored: NonNullable<ProjectSettingsDomainPatch['placement']>['stored'] = {};
  if (isTouched(touchedFields, 'placement.worktreeDirectory')) {
    stored.worktreeRoot = blankToUndefined(form.worktreeDirectory) ?? null;
  }
  if (isTouched(touchedFields, 'placement.tmux')) stored.tmux = form.tmux ?? null;
  if (isTouched(touchedFields, 'placement.defaultWorkspacePreset')) {
    stored.defaultWorkspacePreset =
      form.defaultWorkspacePreset === DEFAULT_WORKSPACE_PRESET ? null : form.defaultWorkspacePreset;
  }
  return Object.keys(stored).length > 0 ? { stored } : undefined;
}

export function formToProjectSettingsDomainPatch(
  form: FormState,
  touchedFields?: ReadonlySet<FormFieldPath>
): ProjectSettingsDomainPatch {
  const lifecycle = lifecycleToPatch(form.lifecycle, touchedFields);
  const fileHandling = fileHandlingToPatch(form.fileHandling, touchedFields);
  const environment = environmentToPatch(form.environment, touchedFields);
  const gitIdentity = gitIdentityToPatch(form.gitIdentity, touchedFields);
  const placement = placementToPatch(form.placement, touchedFields);
  return {
    ...(lifecycle ? { lifecycle } : {}),
    ...(fileHandling ? { fileHandling } : {}),
    ...(environment ? { environment } : {}),
    ...(gitIdentity ? { gitIdentity } : {}),
    ...(placement ? { placement } : {}),
  };
}

function parsePreservePatterns(value: string): string[] {
  return value
    .split('\n')
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

export function effectiveAutoRunToggleValue(
  personalValue: boolean | undefined,
  resolvedValue: boolean
): boolean {
  return personalValue ?? resolvedValue;
}

export function formToStoredGitSettings(
  form: Pick<FormState, 'gitIdentity' | 'placement'>
): StoredProjectGitSettings {
  const { gitIdentity, placement } = form;
  const baseRemote = blankToUndefined(gitIdentity.baseRemote);
  const pushRemote =
    gitIdentity.pushRemote.trim() && gitIdentity.pushRemote.trim() !== gitIdentity.baseRemote.trim()
      ? gitIdentity.pushRemote.trim()
      : undefined;
  const worktreeRoot = blankToUndefined(placement.worktreeDirectory);
  return {
    ...(baseRemote !== undefined ? { baseRemote } : {}),
    ...(pushRemote !== undefined ? { pushRemote } : {}),
    ...(gitIdentity.defaultBranch
      ? { defaultBranch: branchRefToStoredDefaultBranch(gitIdentity.defaultBranch) }
      : {}),
    ...(gitIdentity.githubAccount !== undefined
      ? { githubAccount: gitIdentity.githubAccount }
      : {}),
    ...(worktreeRoot !== undefined ? { worktreeRoot } : {}),
  };
}

export function shareableFieldFormValue(
  form: FormState,
  field: ShareableProjectSettingsWriteField
): string {
  if (field === 'preservePatterns') return form.fileHandling.preservePatterns;
  const key = SHAREABLE_FIELD_DESCRIPTOR_BY_ID[field].formKey;
  return form.lifecycle[key as keyof LifecycleFormState] as string;
}

export function normalizeShareableFieldValue(
  field: ShareableProjectSettingsWriteField,
  value: string
): string {
  return SHAREABLE_FIELD_DESCRIPTOR_BY_ID[field].normalizeText(value);
}

export function getAvailableWriteFields(form: FormState): ShareableProjectSettingsWriteField[] {
  return SHAREABLE_FIELD_DESCRIPTORS.map((descriptor) => descriptor.id).filter((field) =>
    shareableFieldFormValue(form, field).trim()
  );
}

export function areFormStatesEqual(left: FormState, right: FormState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
