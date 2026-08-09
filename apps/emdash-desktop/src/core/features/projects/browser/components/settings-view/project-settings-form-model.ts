import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import { projectDefaultBranchToBranch } from '@core/primitives/git/api';
import type {
  ProjectSettings,
  ShareableProjectSettingsWriteField,
} from '@core/primitives/project-settings/api';
import {
  SHAREABLE_FIELD_DESCRIPTOR_BY_ID,
  SHAREABLE_FIELD_DESCRIPTORS,
  SHAREABLE_FIELD_FORM_KEY,
} from './shareable-project-settings-fields';

export type FormState = {
  preservePatterns: string;
  tmux: boolean;
  autoRunSetupScriptOnTaskCreation: boolean;
  autoRunRunScriptOnTaskCreation: boolean;
  scriptPrepare: string;
  scriptSetup: string;
  scriptRun: string;
  scriptTeardown: string;
  worktreeDirectory: string;
  defaultBranch: GitBranchRef | null;
  baseRemote: string;
  pushRemote: string;
  githubAccountId: string | null | undefined;
};

export type FormUpdate = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

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
    tmux: s.tmux ?? false,
    autoRunSetupScriptOnTaskCreation: s.autoRunSetupScriptOnTaskCreation ?? true,
    autoRunRunScriptOnTaskCreation: s.autoRunRunScriptOnTaskCreation ?? false,
    scriptPrepare: normalizeScript(s.scripts?.prepare),
    scriptSetup: normalizeScript(s.scripts?.setup),
    scriptRun: normalizeScript(s.scripts?.run),
    scriptTeardown: normalizeScript(s.scripts?.teardown),
    worktreeDirectory: s.worktreeDirectory ?? '',
    defaultBranch: projectDefaultBranchToBranch(s.defaultBranch, baseRemoteMeta, remotes) ?? null,
    baseRemote: s.baseRemote ?? '',
    pushRemote: s.pushRemote ?? '',
    githubAccountId: Object.hasOwn(s, 'githubAccountId') ? (s.githubAccountId ?? null) : undefined,
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
    prepare: blankToUndefined(f.scriptPrepare),
    setup: blankToUndefined(f.scriptSetup),
    run: blankToUndefined(f.scriptRun),
    teardown: blankToUndefined(f.scriptTeardown),
  };
  const githubAccountId = githubAccountIdToSettings(f.githubAccountId);
  const hasScripts = Object.values(scripts).some((value) => value !== undefined);
  return {
    preservePatterns: preservePatterns.length > 0 ? preservePatterns : undefined,
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
