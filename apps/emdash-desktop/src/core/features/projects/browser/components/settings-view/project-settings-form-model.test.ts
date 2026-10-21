import type { GitRemote } from '@emdash/core/runtimes/git/api';
import { describe, expect, it } from 'vitest';
import type { ProjectSettingsDomains } from '../../../api/project-settings-page';
import {
  areFormStatesEqual,
  effectiveAutoRunToggleValue,
  formToProjectSettingsDomainPatch,
  formToStoredGitSettings,
  formToStoredIntegrationAccounts,
  getAvailableWriteFields,
  normalizeShareableFieldValue,
  projectSettingsDomainsToForm,
  storedDefaultBranchToBranchRef,
  type EnvironmentFormState,
  type FileHandlingFormState,
  type FormFieldPath,
  type FormState,
  type GitIdentityFormState,
  type IntegrationAccountsFormState,
  type LifecycleFormState,
  type PlacementFormState,
} from './project-settings-form-model';

const origin: GitRemote = { name: 'origin', url: 'git@github.com:example/repo.git' };

type FormOverrides = {
  lifecycle?: Partial<LifecycleFormState>;
  fileHandling?: Partial<FileHandlingFormState>;
  environment?: Partial<EnvironmentFormState>;
  gitIdentity?: Partial<GitIdentityFormState>;
  integrationAccounts?: IntegrationAccountsFormState;
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
    environment: { variables: [], ...overrides.environment },
    gitIdentity: {
      defaultBranch: null,
      baseRemote: '',
      pushRemote: '',
      agentGitCredentials: 'effective-account',
      ...overrides.gitIdentity,
    },
    integrationAccounts: overrides.integrationAccounts ?? {},
    placement: { tmux: undefined, worktreeDirectory: '', ...overrides.placement },
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
    environment: {
      personal: { env: { CLAUDE_CONFIG_DIR: '/configs/work' } },
      resolved: {
        env: { value: { CLAUDE_CONFIG_DIR: '/configs/work' }, from: 'personal' },
      },
    },
    gitIdentity: { stored: { baseRemote: 'origin' } },
    integrationAccounts: { stored: {} },
    placement: {
      stored: { tmux: false },
      layers: {
        hostWorktreeRoot: null,
        builtInWorktreeRoot: '/built-in/worktrees',
        homeDirectory: '/home/test',
        hostTmux: null,
        appDefaultTmux: true,
      },
      resolved: {
        worktreeRoot: {
          value: '/built-in/worktrees',
          provenance: { kind: 'inferred', from: 'built-in default' },
        },
        tmux: { value: false, provenance: { kind: 'set' } },
      },
    },
  };
}

describe('project settings form model', () => {
  it('patches only the provider edited while preserving other live account choices', () => {
    const form = projectSettingsDomainsToForm(domains(), [origin]);
    form.integrationAccounts = {
      github: { kind: 'account', accountId: 'github.com:old' },
      jira: { kind: 'account', accountId: 'jira:new' },
    };
    expect(
      formToProjectSettingsDomainPatch(form, new Set<FormFieldPath>(['integrationAccounts.jira']))
    ).toEqual({
      integrationAccounts: { stored: { jira: { kind: 'account', accountId: 'jira:new' } } },
    });
  });

  it('clears only the reset provider even when another provider has a stored pin', () => {
    const form = projectSettingsDomainsToForm(domains(), [origin]);
    form.integrationAccounts = {
      github: { kind: 'account', accountId: 'github.com:old' },
      jira: null,
    };
    expect(
      formToProjectSettingsDomainPatch(form, new Set<FormFieldPath>(['integrationAccounts.jira']))
    ).toEqual({ integrationAccounts: { stored: { jira: null } } });
  });

  it('binds each section to raw domain layers instead of inherited values', () => {
    const input = domains();
    input.lifecycle.personal = { scripts: { setup: 'personal setup' } };
    input.fileHandling.personal = {};
    input.gitIdentity.stored = {};
    const form = projectSettingsDomainsToForm(input, [origin]);

    expect(form.lifecycle.scriptSetup).toBe('personal setup');
    expect(form.lifecycle.scriptRun).toBe('');
    expect(form.fileHandling.preservePatterns).toBe('');
    expect(form.environment.variables).toEqual([
      { key: 'CLAUDE_CONFIG_DIR', value: '/configs/work' },
    ]);
    expect(form.placement.worktreeDirectory).toBe('');
    expect(form.gitIdentity.baseRemote).toBe('');
  });

  it('emits explicit per-domain patches and null tombstones from touched fields', () => {
    const form = projectSettingsDomainsToForm(domains(), [origin]);
    form.lifecycle.scriptSetup = 'new setup';
    form.lifecycle.scriptRun = '';
    form.lifecycle.autoRunSetupScriptOnTaskCreation = undefined;
    form.fileHandling.preservePatterns = '';
    form.environment.variables = [
      { key: 'CLAUDE_CONFIG_DIR', value: '/configs/personal' },
      { key: '', value: 'ignored' },
    ];
    form.gitIdentity.baseRemote = '';
    form.placement.worktreeDirectory = '/custom/worktrees';
    const touched = new Set<FormFieldPath>([
      'lifecycle.scriptSetup',
      'lifecycle.scriptRun',
      'lifecycle.autoRunSetupScriptOnTaskCreation',
      'fileHandling.preservePatterns',
      'environment.variables',
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
      environment: {
        personal: { env: { CLAUDE_CONFIG_DIR: '/configs/personal' } },
      },
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

  it('keeps inherited tmux unset and emits a tombstone when reset', () => {
    const input = domains();
    input.placement.stored = {};
    input.placement.resolved.tmux = {
      value: true,
      provenance: { kind: 'inferred', from: 'app default' },
    };
    const form = projectSettingsDomainsToForm(input, [origin]);

    expect(form.placement.tmux).toBeUndefined();
    expect(
      formToProjectSettingsDomainPatch(form, new Set<FormFieldPath>(['placement.tmux']))
    ).toEqual({ placement: { stored: { tmux: null } } });
  });

  it('renders inherited auto-run state from the resolved value', () => {
    expect(effectiveAutoRunToggleValue(undefined, true)).toBe(true);
    expect(effectiveAutoRunToggleValue(undefined, false)).toBe(false);
    expect(effectiveAutoRunToggleValue(false, true)).toBe(false);
  });

  it('keeps provider account states and resolver inputs distinct', () => {
    const input = domains();
    input.integrationAccounts.stored = {
      github: { kind: 'account', accountId: 'row-42' },
    };
    expect(projectSettingsDomainsToForm(input, [origin]).integrationAccounts['github']).toEqual({
      kind: 'account',
      accountId: 'row-42',
    });
    input.integrationAccounts.stored = { github: { kind: 'none' } };
    expect(projectSettingsDomainsToForm(input, [origin]).integrationAccounts['github']).toEqual({
      kind: 'none',
    });
    input.integrationAccounts.stored = {};
    expect(projectSettingsDomainsToForm(input, [origin]).integrationAccounts).toEqual({});

    const form = makeForm({
      gitIdentity: {
        defaultBranch: { type: 'remote', branch: 'main', remote: origin },
        baseRemote: 'origin',
        pushRemote: 'upstream',
      },
      integrationAccounts: { github: { kind: 'none' }, jira: null },
      placement: { worktreeDirectory: ' ../worktrees ' },
    });
    // Tombstoned entries (jira: null) never leak into the resolver preview.
    expect(formToStoredGitSettings(form)).toEqual({
      worktreeRoot: '../worktrees',
      defaultBranch: { remote: 'origin', branch: 'main' },
      baseRemote: 'origin',
      pushRemote: 'upstream',
    });
    expect(formToStoredIntegrationAccounts(form.integrationAccounts)).toEqual({
      github: { kind: 'none' },
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
    expect(projectSettingsDomainsToForm(domains(), [origin]).gitIdentity.agentGitCredentials).toBe(
      'effective-account'
    );
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
