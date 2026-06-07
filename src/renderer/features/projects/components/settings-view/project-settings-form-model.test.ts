import { describe, expect, it } from 'vitest';
import type { ProjectSettings } from '@shared/core/project-settings/project-settings';
import type { Remote } from '@shared/git';
import {
  areFormStatesEqual,
  formToSettings,
  getAvailableWriteFields,
  normalizeShareableFieldValue,
  settingsToForm,
  validateWorkspaceProviderCommands,
  type FormState,
} from './project-settings-form-model';

const origin: Remote = { name: 'origin', url: 'git@github.com:example/repo.git' };
const upstream: Remote = { name: 'upstream', url: 'git@github.com:upstream/repo.git' };

function makeForm(overrides: Partial<FormState> = {}): FormState {
  return {
    preservePatterns: '',
    shellSetup: '',
    tmux: false,
    autoRunSetupScriptOnTaskCreation: true,
    autoRunRunScriptOnTaskCreation: false,
    scriptSetup: '',
    scriptRun: '',
    scriptTeardown: '',
    worktreeDirectory: '',
    defaultBranch: null,
    baseRemote: '',
    pushRemote: '',
    provisionCommand: '',
    terminateCommand: '',
    ...overrides,
  };
}

describe('project settings form model', () => {
  it('converts project settings into editable form state', () => {
    const form = settingsToForm(
      {
        preservePatterns: ['.env', '.env.local'],
        shellSetup: 'source .envrc',
        tmux: true,
        autoRunSetupScriptOnTaskCreation: false,
        autoRunRunScriptOnTaskCreation: true,
        scripts: {
          setup: 'pnpm install',
          run: 'pnpm dev',
          teardown: 'docker compose down',
        },
        worktreeDirectory: '../worktrees',
        defaultBranch: 'upstream/main',
        baseRemote: 'upstream',
        pushRemote: 'origin',
        workspaceProvider: {
          type: 'script',
          provisionCommand: './provision.sh',
          terminateCommand: './terminate.sh',
        },
      },
      'origin',
      [origin, upstream]
    );

    expect(form).toEqual({
      preservePatterns: '.env\n.env.local',
      shellSetup: 'source .envrc',
      tmux: true,
      autoRunSetupScriptOnTaskCreation: false,
      autoRunRunScriptOnTaskCreation: true,
      scriptSetup: 'pnpm install',
      scriptRun: 'pnpm dev',
      scriptTeardown: 'docker compose down',
      worktreeDirectory: '../worktrees',
      defaultBranch: { type: 'remote', branch: 'main', remote: upstream },
      baseRemote: 'upstream',
      pushRemote: 'origin',
      provisionCommand: './provision.sh',
      terminateCommand: './terminate.sh',
    });
  });

  it('uses the configured remote for object default branch settings', () => {
    expect(
      settingsToForm({ defaultBranch: { name: 'develop', remote: true } }, 'origin', [origin])
        .defaultBranch
    ).toEqual({ type: 'remote', branch: 'develop', remote: origin });
  });

  it('preserves legacy script arrays as newline separated commands', () => {
    const legacySettings = {
      scripts: {
        setup: ['pnpm install', 'pnpm build'],
      },
    } as unknown as ProjectSettings;

    expect(settingsToForm(legacySettings, 'origin', [origin]).scriptSetup).toBe(
      'pnpm install\npnpm build'
    );
  });

  it('converts form state back into project settings', () => {
    expect(
      formToSettings(
        makeForm({
          preservePatterns: ' .env \n\n.env.local ',
          shellSetup: 'source .envrc',
          tmux: true,
          autoRunSetupScriptOnTaskCreation: false,
          autoRunRunScriptOnTaskCreation: true,
          scriptRun: 'pnpm dev',
          worktreeDirectory: '../worktrees',
          defaultBranch: { type: 'remote', branch: 'main', remote: origin },
          baseRemote: 'origin',
          pushRemote: '',
          provisionCommand: ' ./provision.sh ',
          terminateCommand: ' ./terminate.sh ',
        })
      )
    ).toEqual({
      preservePatterns: ['.env', '.env.local'],
      shellSetup: 'source .envrc',
      tmux: true,
      autoRunSetupScriptOnTaskCreation: false,
      autoRunRunScriptOnTaskCreation: true,
      scripts: {
        setup: undefined,
        run: 'pnpm dev',
        teardown: undefined,
      },
      worktreeDirectory: '../worktrees',
      defaultBranch: 'origin/main',
      baseRemote: 'origin',
      workspaceProvider: {
        type: 'script',
        provisionCommand: './provision.sh',
        terminateCommand: './terminate.sh',
      },
    });
  });

  it('omits default auto-run lifecycle settings from persisted form settings', () => {
    expect(formToSettings(makeForm())).not.toHaveProperty('autoRunSetupScriptOnTaskCreation');
    expect(formToSettings(makeForm())).not.toHaveProperty('autoRunRunScriptOnTaskCreation');
  });

  it('requires workspace provider commands to be filled together', () => {
    expect(
      validateWorkspaceProviderCommands(makeForm({ provisionCommand: './provision.sh' }))
    ).toEqual({
      provisionCommand: undefined,
      terminateCommand: 'Terminate command is required when provision command is set.',
    });
    expect(
      validateWorkspaceProviderCommands(makeForm({ terminateCommand: './terminate.sh' }))
    ).toEqual({
      provisionCommand: 'Provision command is required when terminate command is set.',
      terminateCommand: undefined,
    });
    expect(
      validateWorkspaceProviderCommands(
        makeForm({
          provisionCommand: './provision.sh',
          terminateCommand: './terminate.sh',
        })
      )
    ).toEqual({});
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
      shellSetup: 'source .envrc',
      scriptSetup: 'pnpm install',
      scriptRun: 'pnpm dev',
      scriptTeardown: '',
    });

    expect(getAvailableWriteFields(form)).toEqual([
      'preservePatterns',
      'shellSetup',
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
