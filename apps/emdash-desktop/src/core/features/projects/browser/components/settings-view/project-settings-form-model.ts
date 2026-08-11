import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import type {
  ProjectSettings,
  ShareableProjectSettingsWriteField,
  StoredDefaultBranch,
  StoredGithubAccount,
  StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';
import {
  SHAREABLE_FIELD_DESCRIPTOR_BY_ID,
  SHAREABLE_FIELD_DESCRIPTORS,
  SHAREABLE_FIELD_FORM_KEY,
} from './shareable-project-settings-fields';

/**
 * Git fields hold the stored model semantics (spec: github-git-settings §3):
 * empty string / null / undefined mean "not set — infer live"; provenance
 * over the pending form state comes from running the blessed resolver via
 * `formToStoredGitSettings`.
 */
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
  githubAccount: StoredGithubAccount | undefined;
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

export function settingsToForm(
  s: ProjectSettings,
  storedGitSettings: StoredProjectGitSettings,
  remotes: { name: string; url: string }[]
): FormState {
  return {
    preservePatterns: (s.preservePatterns ?? []).join('\n'),
    tmux: s.tmux ?? false,
    autoRunSetupScriptOnTaskCreation: s.autoRunSetupScriptOnTaskCreation ?? true,
    autoRunRunScriptOnTaskCreation: s.autoRunRunScriptOnTaskCreation ?? false,
    scriptPrepare: normalizeScript(s.scripts?.prepare),
    scriptSetup: normalizeScript(s.scripts?.setup),
    scriptRun: normalizeScript(s.scripts?.run),
    scriptTeardown: normalizeScript(s.scripts?.teardown),
    worktreeDirectory: storedGitSettings.worktreeRoot ?? '',
    defaultBranch: storedDefaultBranchToBranchRef(storedGitSettings.defaultBranch, remotes),
    baseRemote: storedGitSettings.baseRemote ?? '',
    pushRemote: storedGitSettings.pushRemote ?? '',
    githubAccount: storedGitSettings.githubAccount,
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
    ...(f.githubAccount !== undefined
      ? { githubAccountId: f.githubAccount.kind === 'account' ? f.githubAccount.accountId : null }
      : {}),
  };
}

/**
 * The pending form state as resolver input: only explicit choices, blank
 * meaning "infer". Runs the same drop-if-blank rules as `formToSettings` so
 * the provenance preview matches exactly what a save would persist.
 */
export function formToStoredGitSettings(f: FormState): StoredProjectGitSettings {
  const baseRemote = blankToUndefined(f.baseRemote);
  const pushRemote =
    f.pushRemote.trim() && f.pushRemote.trim() !== f.baseRemote.trim()
      ? f.pushRemote.trim()
      : undefined;
  const worktreeRoot = blankToUndefined(f.worktreeDirectory);
  return {
    ...(baseRemote !== undefined ? { baseRemote } : {}),
    ...(pushRemote !== undefined ? { pushRemote } : {}),
    ...(f.defaultBranch ? { defaultBranch: branchRefToStoredDefaultBranch(f.defaultBranch) } : {}),
    ...(f.githubAccount !== undefined ? { githubAccount: f.githubAccount } : {}),
    ...(worktreeRoot !== undefined ? { worktreeRoot } : {}),
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
