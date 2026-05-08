import type { Branch } from '@shared/git';
import type { ProjectSettings, ShareableProjectSettingsWriteField } from '@shared/project-settings';

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

export const DEFAULT_WRITE_FIELDS: ShareableProjectSettingsWriteField[] = [
  'preservePatterns',
  'scripts.setup',
  'scripts.run',
  'scripts.teardown',
];

export const SHAREABLE_FIELD_FORM_KEY = {
  preservePatterns: 'preservePatterns',
  shellSetup: 'shellSetup',
  'scripts.setup': 'scriptSetup',
  'scripts.run': 'scriptRun',
  'scripts.teardown': 'scriptTeardown',
} satisfies Record<ShareableProjectSettingsWriteField, ShareableFieldFormKey>;

function normalizeScript(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val.join('\n');
  return val ?? '';
}

function branchSettingToBranch(
  setting: ProjectSettings['defaultBranch'],
  configuredRemote: string,
  remotes: { name: string; url: string }[]
): Branch | null {
  if (!setting) return null;
  const configuredRemoteMeta = remotes.find((remote) => remote.name === configuredRemote) ?? {
    name: configuredRemote,
    url: '',
  };
  if (typeof setting !== 'string') {
    return {
      type: 'remote',
      branch: setting.name,
      remote: configuredRemoteMeta,
    };
  }

  const matchingRemote = remotes.find((remote) => setting.startsWith(`${remote.name}/`));
  if (matchingRemote) {
    return {
      type: 'remote',
      branch: setting.slice(matchingRemote.name.length + 1),
      remote: matchingRemote,
    };
  }

  const slash = setting.indexOf('/');
  if (slash > 0) {
    return {
      type: 'remote',
      branch: setting.slice(slash + 1),
      remote: { name: setting.slice(0, slash), url: '' },
    };
  }

  return { type: 'local', branch: setting };
}

export function settingsToForm(
  s: ProjectSettings,
  configuredRemote: string,
  remotes: { name: string; url: string }[]
): FormState {
  return {
    preservePatterns: (s.preservePatterns ?? []).join('\n'),
    shellSetup: s.shellSetup ?? '',
    tmux: s.tmux ?? false,
    scriptSetup: normalizeScript(s.scripts?.setup),
    scriptRun: normalizeScript(s.scripts?.run),
    scriptTeardown: normalizeScript(s.scripts?.teardown),
    worktreeDirectory: s.worktreeDirectory ?? '',
    defaultBranch: branchSettingToBranch(s.defaultBranch, configuredRemote, remotes),
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
  const fields: ShareableProjectSettingsWriteField[] = [];
  if (form.preservePatterns.trim()) fields.push('preservePatterns');
  if (form.scriptSetup.trim()) fields.push('scripts.setup');
  if (form.scriptRun.trim()) fields.push('scripts.run');
  if (form.scriptTeardown.trim()) fields.push('scripts.teardown');
  if (form.shellSetup.trim()) fields.push('shellSetup');
  return fields;
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
