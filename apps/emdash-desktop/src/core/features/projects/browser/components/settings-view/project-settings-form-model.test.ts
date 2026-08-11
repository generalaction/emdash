import type { GitRemote } from '@emdash/core/runtimes/git/api';
import { describe, expect, it } from 'vitest';
import type { ProjectSettings } from '@core/primitives/project-settings/api';
import {
  areFormStatesEqual,
  formToSettings,
  formToStoredGitSettings,
  getAvailableWriteFields,
  normalizeShareableFieldValue,
  settingsToForm,
  storedDefaultBranchToBranchRef,
  type FormState,
} from './project-settings-form-model';

const origin: GitRemote = { name: 'origin', url: 'git@github.com:example/repo.git' };
const upstream: GitRemote = { name: 'upstream', url: 'git@github.com:upstream/repo.git' };

function makeForm(overrides: Partial<FormState> = {}): FormState {
  return {
    preservePatterns: '',
    tmux: false,
    autoRunSetupScriptOnTaskCreation: true,
    autoRunRunScriptOnTaskCreation: false,
    scriptPrepare: '',
    scriptSetup: '',
    scriptRun: '',
    scriptTeardown: '',
    worktreeDirectory: '',
    defaultBranch: null,
    baseRemote: '',
    pushRemote: '',
    githubAccount: undefined,
    agentGitCredentials: 'effective-account',
    ...overrides,
  };
}

describe('project settings form model', () => {
  it('converts project settings and stored git choices into editable form state', () => {
    const form = settingsToForm(
      {
        preservePatterns: ['.env', '.env.local'],
        tmux: true,
        autoRunSetupScriptOnTaskCreation: false,
        autoRunRunScriptOnTaskCreation: true,
        scripts: {
          prepare: 'python -m venv .venv',
          setup: 'pnpm install',
          run: 'pnpm dev',
          teardown: 'docker compose down',
        },
      },
      {
        worktreeRoot: '../worktrees',
        defaultBranch: { remote: 'upstream', branch: 'main' },
        baseRemote: 'upstream',
        pushRemote: 'origin',
      },
      [origin, upstream]
    );

    expect(form).toEqual({
      preservePatterns: '.env\n.env.local',
      tmux: true,
      autoRunSetupScriptOnTaskCreation: false,
      autoRunRunScriptOnTaskCreation: true,
      scriptPrepare: 'python -m venv .venv',
      scriptSetup: 'pnpm install',
      scriptRun: 'pnpm dev',
      scriptTeardown: 'docker compose down',
      worktreeDirectory: '../worktrees',
      defaultBranch: { type: 'remote', branch: 'main', remote: upstream },
      baseRemote: 'upstream',
      pushRemote: 'origin',
      githubAccount: undefined,
      agentGitCredentials: 'effective-account',
    });
  });

  it('leaves unset git choices unset instead of inventing defaults', () => {
    const form = settingsToForm({}, {}, [origin]);

    expect(form.worktreeDirectory).toBe('');
    expect(form.defaultBranch).toBeNull();
    expect(form.baseRemote).toBe('');
    expect(form.pushRemote).toBe('');
    expect(form.githubAccount).toBeUndefined();
  });

  it('maps stored default branches to branch refs', () => {
    expect(storedDefaultBranchToBranchRef({ remote: null, branch: 'main' }, [origin])).toEqual({
      type: 'local',
      branch: 'main',
    });
    expect(storedDefaultBranchToBranchRef({ remote: 'origin', branch: 'main' }, [origin])).toEqual({
      type: 'remote',
      branch: 'main',
      remote: origin,
    });
    // A stored remote that no longer exists keeps its name for display.
    expect(storedDefaultBranchToBranchRef({ remote: 'gone', branch: 'main' }, [origin])).toEqual({
      type: 'remote',
      branch: 'main',
      remote: { name: 'gone', url: '' },
    });
  });

  it('preserves legacy script arrays as newline separated commands', () => {
    const legacySettings = {
      scripts: {
        setup: ['pnpm install', 'pnpm build'],
      },
    } as unknown as ProjectSettings;

    expect(settingsToForm(legacySettings, {}, [origin]).scriptSetup).toBe(
      'pnpm install\npnpm build'
    );
  });

  it('converts form state back into project settings', () => {
    expect(
      formToSettings(
        makeForm({
          preservePatterns: ' .env \n\n.env.local ',
          tmux: true,
          autoRunSetupScriptOnTaskCreation: false,
          autoRunRunScriptOnTaskCreation: true,
          scriptRun: 'pnpm dev',
          worktreeDirectory: '../worktrees',
          defaultBranch: { type: 'remote', branch: 'main', remote: origin },
          baseRemote: 'origin',
          pushRemote: '',
        })
      )
    ).toEqual({
      preservePatterns: ['.env', '.env.local'],
      tmux: true,
      autoRunSetupScriptOnTaskCreation: false,
      autoRunRunScriptOnTaskCreation: true,
      scripts: {
        prepare: undefined,
        setup: undefined,
        run: 'pnpm dev',
        teardown: undefined,
      },
      worktreeDirectory: '../worktrees',
      defaultBranch: 'origin/main',
      baseRemote: 'origin',
    });
  });

  it('keeps the stored github account representation distinct across all three states', () => {
    expect(
      settingsToForm({}, { githubAccount: { kind: 'account', accountId: 'row-42' } }, [origin])
        .githubAccount
    ).toEqual({ kind: 'account', accountId: 'row-42' });
    expect(settingsToForm({}, { githubAccount: { kind: 'none' } }, [origin]).githubAccount).toEqual(
      { kind: 'none' }
    );
    expect(settingsToForm({}, {}, [origin]).githubAccount).toBeUndefined();
  });

  it('persists explicit GitHub account choices through the legacy wire shape', () => {
    expect(
      formToSettings(makeForm({ githubAccount: { kind: 'account', accountId: 'row-42' } }))
    ).toEqual({
      tmux: false,
      githubAccountId: 'row-42',
    });
    expect(formToSettings(makeForm({ githubAccount: { kind: 'none' } }))).toEqual({
      tmux: false,
      githubAccountId: null,
    });
    expect(formToSettings(makeForm({ githubAccount: undefined }))).toEqual({ tmux: false });
  });

  it('maps pending form state to resolver input with blanks meaning infer', () => {
    expect(formToStoredGitSettings(makeForm())).toEqual({});
    expect(
      formToStoredGitSettings(
        makeForm({
          worktreeDirectory: ' ../worktrees ',
          defaultBranch: { type: 'remote', branch: 'main', remote: origin },
          baseRemote: 'origin',
          pushRemote: 'upstream',
          githubAccount: { kind: 'none' },
        })
      )
    ).toEqual({
      worktreeRoot: '../worktrees',
      defaultBranch: { remote: 'origin', branch: 'main' },
      baseRemote: 'origin',
      pushRemote: 'upstream',
      githubAccount: { kind: 'none' },
    });
  });

  it('drops a push remote equal to the base remote, matching what a save persists', () => {
    const form = makeForm({ baseRemote: 'origin', pushRemote: 'origin' });

    expect(formToStoredGitSettings(form).pushRemote).toBeUndefined();
    expect(formToSettings(form).pushRemote).toBeUndefined();
  });

  it('round-trips the agent git credentials setting with absence meaning the default', () => {
    expect(settingsToForm({}, {}, [origin]).agentGitCredentials).toBe('effective-account');
    expect(settingsToForm({ agentGitCredentials: 'none' }, {}, [origin]).agentGitCredentials).toBe(
      'none'
    );

    expect(formToSettings(makeForm())).not.toHaveProperty('agentGitCredentials');
    expect(formToSettings(makeForm({ agentGitCredentials: 'system' })).agentGitCredentials).toBe(
      'system'
    );
    expect(formToSettings(makeForm({ agentGitCredentials: 'none' })).agentGitCredentials).toBe(
      'none'
    );
  });

  it('omits default auto-run lifecycle settings from persisted form settings', () => {
    expect(formToSettings(makeForm())).not.toHaveProperty('autoRunSetupScriptOnTaskCreation');
    expect(formToSettings(makeForm())).not.toHaveProperty('autoRunRunScriptOnTaskCreation');
  });

  it('normalizes shareable field values for comparison', () => {
    expect(normalizeShareableFieldValue('preservePatterns', ' .env \n\n .env.local ')).toBe(
      '.env\n.env.local'
    );
    expect(normalizeShareableFieldValue('scripts.run', ' pnpm dev \n')).toBe('pnpm dev');
  });

  it('detects shareable form fields', () => {
    const form = makeForm({
      preservePatterns: '.env',
      scriptPrepare: 'python -m venv .venv',
      scriptSetup: 'pnpm install',
      scriptRun: 'pnpm dev',
      scriptTeardown: '',
    });

    expect(getAvailableWriteFields(form)).toEqual([
      'preservePatterns',
      'scripts.prepare',
      'scripts.setup',
      'scripts.run',
    ]);
  });

  it('compares form states through a named helper', () => {
    const form = makeForm({ scriptRun: 'pnpm dev' });

    expect(areFormStatesEqual(form, makeForm({ scriptRun: 'pnpm dev' }))).toBe(true);
    expect(areFormStatesEqual(form, makeForm({ scriptRun: 'pnpm test' }))).toBe(false);
  });
});
