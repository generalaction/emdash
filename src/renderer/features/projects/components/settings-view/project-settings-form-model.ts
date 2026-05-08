import type { Branch } from '@shared/git';
import { projectDefaultBranchToBranch } from '@shared/git-utils';
import {
  SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS,
  type ProjectSettings,
  type ShareableProjectSettingsWriteField,
} from '@shared/project-settings';

export type FormState = {
  preservePatterns: string;
  shellSetup: string;
  tmux: boolean;
  scriptSetup: string;
  scriptRun: string;
  scriptTeardown: string;
  worktreeDirectory: string;
  defaultBranch: Branch | null;
  remote: string;
  provisionCommand: string;
  terminateCommand: string;
};

export type FormUpdate = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

export type WorkspaceProviderValidationErrors = Partial<
  Record<'provisionCommand' | 'terminateCommand', string>
>;

export type ShareableFieldFormKey =
  | 'preservePatterns'
  | 'shellSetup'
  | 'scriptSetup'
  | 'scriptRun'
  | 'scriptTeardown';

type ShareableFormFieldConfig = {
  formKey: keyof FormState;
  defaultWrite: boolean;
};

const SHAREABLE_FORM_FIELD_CONFIG = {
  preservePatterns: { formKey: 'preservePatterns', defaultWrite: true },
  shellSetup: { formKey: 'shellSetup', defaultWrite: false },
  'scripts.setup': { formKey: 'scriptSetup', defaultWrite: true },
  'scripts.run': { formKey: 'scriptRun', defaultWrite: true },
  'scripts.teardown': { formKey: 'scriptTeardown', defaultWrite: true },
} satisfies Record<ShareableProjectSettingsWriteField, ShareableFormFieldConfig>;

export const DEFAULT_WRITE_FIELDS: ShareableProjectSettingsWriteField[] =
  SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS.filter(
    (field) => SHAREABLE_FORM_FIELD_CONFIG[field].defaultWrite
  );

export const SHAREABLE_FIELD_FORM_KEY = Object.fromEntries(
  SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS.map((field) => [
    field,
    SHAREABLE_FORM_FIELD_CONFIG[field].formKey,
  ])
) as Record<ShareableProjectSettingsWriteField, ShareableFieldFormKey>;

function normalizeScript(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val.join('\n');
  return val ?? '';
}

export function settingsToForm(
  s: ProjectSettings,
  configuredRemote: string,
  remotes: { name: string; url: string }[]
): FormState {
  const configuredRemoteMeta = remotes.find((remote) => remote.name === configuredRemote) ?? {
    name: configuredRemote,
    url: '',
  };

  return {
    preservePatterns: (s.preservePatterns ?? []).join('\n'),
    shellSetup: s.shellSetup ?? '',
    tmux: s.tmux ?? false,
    scriptSetup: normalizeScript(s.scripts?.setup),
    scriptRun: normalizeScript(s.scripts?.run),
    scriptTeardown: normalizeScript(s.scripts?.teardown),
    worktreeDirectory: s.worktreeDirectory ?? '',
    defaultBranch:
      projectDefaultBranchToBranch(s.defaultBranch, configuredRemoteMeta, remotes) ?? null,
    remote: s.remote ?? '',
    provisionCommand: s.workspaceProvider?.provisionCommand ?? '',
    terminateCommand: s.workspaceProvider?.terminateCommand ?? '',
  };
}

export function formToSettings(f: FormState): ProjectSettings {
  let defaultBranch: ProjectSettings['defaultBranch'];
  if (f.defaultBranch) {
    defaultBranch =
      f.defaultBranch.type === 'remote'
        ? `${f.defaultBranch.remote.name}/${f.defaultBranch.branch}`
        : f.defaultBranch.branch;
  }
  const preservePatterns = f.preservePatterns
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  const scripts = {
    setup: f.scriptSetup || undefined,
    run: f.scriptRun || undefined,
    teardown: f.scriptTeardown || undefined,
  };
  const provisionCommand = f.provisionCommand.trim();
  const terminateCommand = f.terminateCommand.trim();
  const hasScripts = Object.values(scripts).some((value) => value !== undefined);
  return {
    preservePatterns: preservePatterns.length > 0 ? preservePatterns : undefined,
    shellSetup: f.shellSetup || undefined,
    tmux: f.tmux,
    scripts: hasScripts ? scripts : undefined,
    worktreeDirectory: f.worktreeDirectory || undefined,
    defaultBranch,
    remote: f.remote || undefined,
    workspaceProvider:
      provisionCommand && terminateCommand
        ? {
            type: 'script',
            provisionCommand,
            terminateCommand,
          }
        : undefined,
  };
}

export function validateWorkspaceProviderCommands(
  form: FormState
): WorkspaceProviderValidationErrors {
  const hasProvisionCommand = form.provisionCommand.trim().length > 0;
  const hasTerminateCommand = form.terminateCommand.trim().length > 0;

  if (hasProvisionCommand === hasTerminateCommand) return {};

  return {
    provisionCommand: hasProvisionCommand
      ? undefined
      : 'Provision command is required when terminate command is set.',
    terminateCommand: hasTerminateCommand
      ? undefined
      : 'Terminate command is required when provision command is set.',
  };
}

export function normalizeShareableFieldValue(
  field: ShareableProjectSettingsWriteField,
  value: string
): string {
  if (field === 'preservePatterns') {
    return value
      .split('\n')
      .map((pattern) => pattern.trim())
      .filter(Boolean)
      .join('\n');
  }
  return value.trim();
}

export function getAvailableWriteFields(form: FormState): ShareableProjectSettingsWriteField[] {
  return SHAREABLE_PROJECT_SETTINGS_WRITE_FIELDS.filter((field) =>
    String(form[SHAREABLE_FORM_FIELD_CONFIG[field].formKey]).trim()
  );
}

export function clearFormShareableFields(
  form: FormState,
  fields: ShareableProjectSettingsWriteField[]
): FormState {
  const next = { ...form };
  for (const field of fields) {
    next[SHAREABLE_FIELD_FORM_KEY[field]] = '';
  }
  return next;
}

export function areFormStatesEqual(a: FormState, b: FormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
