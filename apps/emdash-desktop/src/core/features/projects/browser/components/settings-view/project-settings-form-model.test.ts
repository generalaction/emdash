import type { GitRemote } from '@emdash/core/runtimes/git/api';
import { describe, expect, it } from 'vitest';
import type { ProjectSettings } from '@core/primitives/project-settings/api';
import type { ProjectSettingsDomains } from '../../../api/project-settings-page';
import {
  areFormStatesEqual,
  effectiveAutoRunToggleValue,
  formToProjectSettingsDomainPatch,
  formToSettings,
  formToStoredGitSettings,
  getAvailableWriteFields,
  normalizeShareableFieldValue,
  projectSettingsDomainsToForm,
  settingsToForm,
  storedDefaultBranchToBranchRef,
  type FileHandlingFormState,
  type FormFieldPath,
  type FormState,
  type GitIdentityFormState,
  type LifecycleFormState,
  type PlacementFormState,
} from './project-settings-form-model';

const origin: GitRemote = { name: 'origin', url: 'git@github.com:example/repo.git' };
const upstream: GitRemote = { name: 'upstream', url: 'git@github.com:upstream/repo.git' };

type FormOverrides = {
  lifecycle?: Partial<LifecycleFormState>;
  fileHandling?: Partial<FileHandlingFormState>;
  gitIdentity?: Partial<GitIdentityFormState>;
  placement?: Partial<PlacementFormState>;
};

function makeForm(overrides: FormOverrides = {}): FormState {
  return {
    lifecycle: {
      autoRunSetupScriptOnTaskCreation: true,
      autoRunRunScriptOnTaskCreation: false,
      scriptPrepare: '',
      scriptSetup: '',
      scriptRun: '',
      scriptTeardown: '',
      ...overrides.lifecycle,
    },
    fileHandling: { preservePatterns: '', ...overrides.fileHandling },
    gitIdentity: {
      defaultBranch: null,
      baseRemote: '',
      pushRemote: '',
      githubAccount: undefined,
      agentGitCredentials: 'effective-account',
      ...overrides.gitIdentity,
    },
    placement: { tmux: false, worktreeDirectory: '', ...overrides.placement },
  };
}

function domains(): ProjectSettingsDomains {
  return {
    lifecycle: {
      personal: { scripts: { setup: 'personal setup', run: 'personal run' }, autoRunSetup: true },
      team: { scripts: { setup: 'team setup', run: 'team run' } },
      resolved: {
        setup: { value: 'personal setup', from: 'personal' },
        run: { value: 'personal run', from: 'personal' },
        autoRunSetup: { value: true, from: 'personal' },
        autoRunRun: { value: false, from: 'built-in' },
      },
      sources: { prepare: [], setup: [], run: [], teardown: [] },
      writeTargets: [],
    },
    fileHandling: {
      personal: { preservePatterns: ['.env.local'] },
      team: { preservePatterns: ['.env'] },
      resolved: { preservePatterns: { value: ['.env.local'], from: 'personal' } },
      sources: [],
      writeTargets: [],
    },
    gitIdentity: { stored: { baseRemote: 'origin' } },
    placement: {
      stored: { tmux: false },
      layers: {
        hostWorktreeRoot: null,
        builtInWorktreeRoot: '/built-in/worktrees',
        homeDirectory: '/home/test',
      },
      resolved: {
        worktreeRoot: {
          value: '/built-in/worktrees',
          provenance: { kind: 'inferred', from: 'built-in default' },
        },
      },
    },
  };
}

describe('project settings form model', () => {
  it('binds each section to raw domain layers instead of inherited values', () => {
    const input = domains();
    input.lifecycle.personal = { scripts: { setup: 'personal setup' } };
    input.fileHandling.personal = {};
    input.gitIdentity.stored = {};
    const form = projectSettingsDomainsToForm(input, [origin]);

    expect(form.lifecycle.scriptSetup).toBe('personal setup');
    expect(form.lifecycle.scriptRun).toBe('');
    expect(form.fileHandling.preservePatterns).toBe('');
    expect(form.placement.worktreeDirectory).toBe('');
    expect(form.gitIdentity.baseRemote).toBe('');
  });

  it('emits explicit per-domain patches and null tombstones from touched fields', () => {
    const form = projectSettingsDomainsToForm(domains(), [origin]);
    form.lifecycle.scriptSetup = 'new setup';
    form.lifecycle.scriptRun = '';
    form.lifecycle.autoRunSetupScriptOnTaskCreation = undefined;
    form.fileHandling.preservePatterns = '';
    form.gitIdentity.baseRemote = '';
    form.placement.worktreeDirectory = '/custom/worktrees';
    const touched = new Set<FormFieldPath>([
      'lifecycle.scriptSetup',
      'lifecycle.scriptRun',
      'lifecycle.autoRunSetupScriptOnTaskCreation',
      'fileHandling.preservePatterns',
      'gitIdentity.baseRemote',
      'placement.worktreeDirectory',
    ]);

    expect(formToProjectSettingsDomainPatch(form, touched)).toEqual({
      lifecycle: {
        personal: {
          scripts: { setup: 'new setup', run: null },
          autoRunSetup: null,
        },
      },
      fileHandling: { personal: { preservePatterns: null } },
      gitIdentity: { stored: { baseRemote: null } },
      placement: { stored: { worktreeRoot: '/custom/worktrees' } },
    });
  });

  it('uses touched fields alone when live domains change during an edit', () => {
    const staleForm = projectSettingsDomainsToForm(domains(), [origin]);
    staleForm.gitIdentity.baseRemote = 'upstream';
    staleForm.lifecycle.scriptSetup = 'stale setup';

    expect(
      formToProjectSettingsDomainPatch(
        staleForm,
        new Set<FormFieldPath>(['gitIdentity.baseRemote'])
      )
    ).toEqual({ gitIdentity: { stored: { baseRemote: 'upstream' } } });
  });

  it('emits both an edited script and an intentional script reset', () => {
    const form = projectSettingsDomainsToForm(domains(), [origin]);
    form.lifecycle.scriptSetup = 'setup D';
    expect(
      formToProjectSettingsDomainPatch(form, new Set<FormFieldPath>(['lifecycle.scriptSetup']))
    ).toEqual({ lifecycle: { personal: { scripts: { setup: 'setup D' } } } });

    form.lifecycle.scriptSetup = '';
    expect(
      formToProjectSettingsDomainPatch(form, new Set<FormFieldPath>(['lifecycle.scriptSetup']))
    ).toEqual({ lifecycle: { personal: { scripts: { setup: null } } } });
  });

  it('renders inherited auto-run state from the resolved value', () => {
    expect(effectiveAutoRunToggleValue(undefined, true)).toBe(true);
    expect(effectiveAutoRunToggleValue(undefined, false)).toBe(false);
    expect(effectiveAutoRunToggleValue(false, true)).toBe(false);
  });

  it('converts legacy settings payloads into the decomposed form', () => {
    const form = settingsToForm(
      {
        preservePatterns: ['.env'],
        tmux: true,
        autoRunSetupScriptOnTaskCreation: false,
        scripts: { setup: 'pnpm install' },
      },
      {
        worktreeRoot: '../worktrees',
        defaultBranch: { remote: 'upstream', branch: 'main' },
        baseRemote: 'upstream',
      },
      [origin, upstream]
    );

    expect(form.lifecycle.scriptSetup).toBe('pnpm install');
    expect(form.fileHandling.preservePatterns).toBe('.env');
    expect(form.gitIdentity.defaultBranch).toEqual({
      type: 'remote',
      branch: 'main',
      remote: upstream,
    });
    expect(form.placement).toEqual({ tmux: true, worktreeDirectory: '../worktrees' });
  });

  it('preserves legacy script arrays as newline separated commands', () => {
    const legacySettings = {
      scripts: { setup: ['pnpm install', 'pnpm build'] },
    } as unknown as ProjectSettings;
    expect(settingsToForm(legacySettings, {}, [origin]).lifecycle.scriptSetup).toBe(
      'pnpm install\npnpm build'
    );
  });

  it('converts the decomposed form back into the legacy hook payload', () => {
    expect(
      formToSettings(
        makeForm({
          lifecycle: {
            autoRunSetupScriptOnTaskCreation: false,
            autoRunRunScriptOnTaskCreation: true,
            scriptRun: 'pnpm dev',
          },
          fileHandling: { preservePatterns: ' .env \n\n.env.local ' },
          gitIdentity: {
            defaultBranch: { type: 'remote', branch: 'main', remote: origin },
            baseRemote: 'origin',
          },
          placement: { tmux: true, worktreeDirectory: '../worktrees' },
        })
      )
    ).toMatchObject({
      preservePatterns: ['.env', '.env.local'],
      tmux: true,
      autoRunSetupScriptOnTaskCreation: false,
      autoRunRunScriptOnTaskCreation: true,
      scripts: { run: 'pnpm dev' },
      worktreeDirectory: '../worktrees',
      defaultBranch: 'origin/main',
      baseRemote: 'origin',
    });
  });

  it('keeps GitHub account states and resolver inputs distinct', () => {
    expect(
      settingsToForm({}, { githubAccount: { kind: 'account', accountId: 'row-42' } }, [origin])
        .gitIdentity.githubAccount
    ).toEqual({ kind: 'account', accountId: 'row-42' });
    expect(
      settingsToForm({}, { githubAccount: { kind: 'none' } }, [origin]).gitIdentity
    ).toHaveProperty('githubAccount', { kind: 'none' });
    expect(settingsToForm({}, {}, [origin]).gitIdentity.githubAccount).toBeUndefined();

    const form = makeForm({
      gitIdentity: {
        defaultBranch: { type: 'remote', branch: 'main', remote: origin },
        baseRemote: 'origin',
        pushRemote: 'upstream',
        githubAccount: { kind: 'none' },
      },
      placement: { worktreeDirectory: ' ../worktrees ' },
    });
    expect(formToStoredGitSettings(form)).toEqual({
      worktreeRoot: '../worktrees',
      defaultBranch: { remote: 'origin', branch: 'main' },
      baseRemote: 'origin',
      pushRemote: 'upstream',
      githubAccount: { kind: 'none' },
    });
  });

  it('maps stored branches and default agent credentials correctly', () => {
    expect(storedDefaultBranchToBranchRef({ remote: null, branch: 'main' }, [origin])).toEqual({
      type: 'local',
      branch: 'main',
    });
    expect(storedDefaultBranchToBranchRef({ remote: 'gone', branch: 'main' }, [origin])).toEqual({
      type: 'remote',
      branch: 'main',
      remote: { name: 'gone', url: '' },
    });
    expect(settingsToForm({}, {}, [origin]).gitIdentity.agentGitCredentials).toBe(
      'effective-account'
    );
    expect(
      formToSettings(makeForm({ gitIdentity: { agentGitCredentials: 'system' } }))
        .agentGitCredentials
    ).toBe('system');
  });

  it('normalizes and detects shareable fields by section', () => {
    expect(normalizeShareableFieldValue('preservePatterns', ' .env \n\n .env.local ')).toBe(
      '.env\n.env.local'
    );
    const form = makeForm({
      fileHandling: { preservePatterns: '.env' },
      lifecycle: {
        scriptPrepare: 'python -m venv .venv',
        scriptSetup: 'pnpm install',
        scriptRun: 'pnpm dev',
      },
    });
    expect(getAvailableWriteFields(form)).toEqual([
      'preservePatterns',
      'scripts.prepare',
      'scripts.setup',
      'scripts.run',
    ]);
  });

  it('compares decomposed form states through a named helper', () => {
    const form = makeForm({ lifecycle: { scriptRun: 'pnpm dev' } });
    expect(areFormStatesEqual(form, makeForm({ lifecycle: { scriptRun: 'pnpm dev' } }))).toBe(true);
    expect(areFormStatesEqual(form, makeForm({ lifecycle: { scriptRun: 'pnpm test' } }))).toBe(
      false
    );
  });
});
