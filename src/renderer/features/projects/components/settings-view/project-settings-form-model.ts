import type { Branch } from '@shared/core/git/git';
import { projectDefaultBranchToBranch } from '@shared/core/git/git-utils';
import type {
  ProjectSettings,
  ShareableProjectSettingsWriteField,
} from '@shared/core/project-settings/project-settings';
import {
  SHAREABLE_FIELD_DESCRIPTOR_BY_ID,
  SHAREABLE_FIELD_DESCRIPTORS,
  SHAREABLE_FIELD_FORM_KEY,
} from './shareable-project-settings-fields';

export type FormState = {
  preservePatterns: string;
  shellSetup: string;
  tmux: boolean;
  autoRunSetupScriptOnTaskCreation: boolean;
  autoRunRunScriptOnTaskCreation: boolean;
  scriptSetup: string;
  scriptRun: string;
  scriptTeardown: string;
  worktreeDirectory: string;
  defaultBranch: Branch | null;
  baseRemote: string;
  pushRemote: string;
  githubAccountId: string | null | undefined;
  provisionCommand: string;
  terminateCommand: string;
};

export type FormUpdate = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

export type WorkspaceProviderValidationErrors = Partial<
  Record<'provisionCommand' | 'terminateCommand', string>
>;

function normalizeScript(val: string | string[] | undefined): string {
  if (Array.isArray(val)) return val.join('\n');
  return val ?? '';
}

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function githubAccountIdToSettings(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value.trim() || null;
}

export function settingsToForm(
  s: ProjectSettings,
  baseRemote: string,
  remotes: { name: string; url: string }[]
): FormState {
  const baseRemoteMeta = remotes.find((remote) => remote.name === baseRemote) ?? {
    name: baseRemote,
    url: '',
  };

  return {
    preservePatterns: (s.preservePatterns ?? []).join('\n'),
    shellSetup: s.shellSetup ?? '',
    tmux: s.tmux ?? false,
    autoRunSetupScriptOnTaskCreation: s.autoRunSetupScriptOnTaskCreation ?? true,
    autoRunRunScriptOnTaskCreation: s.autoRunRunScriptOnTaskCreation ?? false,
    scriptSetup: normalizeScript(s.scripts?.setup),
    scriptRun: normalizeScript(s.scripts?.run),
    scriptTeardown: normalizeScript(s.scripts?.teardown),
    worktreeDirectory: s.worktreeDirectory ?? '',
    defaultBranch: projectDefaultBranchToBranch(s.defaultBranch, baseRemoteMeta, remotes) ?? null,
    baseRemote: s.baseRemote ?? '',
    pushRemote: s.pushRemote ?? '',
    githubAccountId: Object.hasOwn(s, 'githubAccountId') ? (s.githubAccountId ?? null) : undefined,
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
    setup: blankToUndefined(f.scriptSetup),
    run: blankToUndefined(f.scriptRun),
    teardown: blankToUndefined(f.scriptTeardown),
  };
  const provisionCommand = blankToUndefined(f.provisionCommand);
  const terminateCommand = blankToUndefined(f.terminateCommand);
  const githubAccountId = githubAccountIdToSettings(f.githubAccountId);
  const hasScripts = Object.values(scripts).some((value) => value !== undefined);
  return {
    preservePatterns: preservePatterns.length > 0 ? preservePatterns : undefined,
    shellSetup: blankToUndefined(f.shellSetup),
    tmux: f.tmux,
    ...(f.autoRunSetupScriptOnTaskCreation ? {} : { autoRunSetupScriptOnTaskCreation: false }),
    ...(f.autoRunRunScriptOnTaskCreation ? { autoRunRunScriptOnTaskCreation: true } : {}),
    scripts: hasScripts ? scripts : undefined,
    worktreeDirectory: blankToUndefined(f.worktreeDirectory),
    defaultBranch,
    baseRemote: blankToUndefined(f.baseRemote),
    pushRemote:
      f.pushRemote.trim() && f.pushRemote.trim() !== f.baseRemote.trim()
        ? f.pushRemote.trim()
        : undefined,
    ...(githubAccountId !== undefined ? { githubAccountId } : {}),
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
  return SHAREABLE_FIELD_DESCRIPTOR_BY_ID[field].normalizeText(value);
}

export function getAvailableWriteFields(form: FormState): ShareableProjectSettingsWriteField[] {
  return SHAREABLE_FIELD_DESCRIPTORS.map((descriptor) => descriptor.id).filter((field) =>
    String(form[SHAREABLE_FIELD_FORM_KEY[field]]).trim()
  );
}

export function areFormStatesEqual(a: FormState, b: FormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
