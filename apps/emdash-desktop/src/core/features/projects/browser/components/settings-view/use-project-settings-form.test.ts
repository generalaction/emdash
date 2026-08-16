// @vitest-environment jsdom

import type { GitRemote } from '@emdash/core/runtimes/git/api';
import { ok } from '@emdash/shared';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSettingsDomains } from '../../../api/project-settings-page';
import { useProjectSettingsForm } from './use-project-settings-form';

vi.mock('@emdash/ui/react/primitives', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@core/manifests/browser/modal-api', () => ({
  useOpenModal: () => vi.fn(),
}));

const origin: GitRemote = { name: 'origin', url: 'git@github.com:example/repo.git' };

function domains(setup: string): ProjectSettingsDomains {
  return {
    lifecycle: {
      personal: { scripts: { setup } },
      team: {},
      resolved: {
        setup: { value: setup, from: 'personal' },
        autoRunSetup: { value: true, from: 'built-in' },
        autoRunRun: { value: false, from: 'built-in' },
      },
      sources: { prepare: [], setup: [], run: [], teardown: [] },
      writeTargets: [],
    },
    fileHandling: {
      personal: {},
      team: {},
      resolved: { preservePatterns: { value: [], from: 'built-in' } },
      sources: [],
      writeTargets: [],
    },
    gitIdentity: { stored: {} },
    placement: {
      stored: {},
      layers: {
        hostWorktreeRoot: null,
        builtInWorktreeRoot: '/built-in/worktrees',
        homeDirectory: '/home/test',
        hostTmux: null,
        appDefaultTmux: false,
      },
      resolved: {
        worktreeRoot: {
          value: '/built-in/worktrees',
          provenance: { kind: 'inferred', from: 'built-in default' },
        },
        tmux: { value: false, provenance: { kind: 'inferred', from: 'app default' } },
      },
    },
  };
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('useProjectSettingsForm', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('does not roll back a concurrent lifecycle update when saving a touched git field', async () => {
    const saved = domains('setup C');
    const save = vi.fn(async () =>
      ok({
        durable: {
          gitIdentity: saved.gitIdentity,
          placement: { stored: saved.placement.stored },
        },
        host: {
          kind: 'observed' as const,
          observedAt: 1,
          value: {
            domains: {
              lifecycle: saved.lifecycle,
              fileHandling: saved.fileHandling,
              placement: {
                layers: saved.placement.layers,
                resolved: saved.placement.resolved,
              },
            },
            configMigrations: [],
            shouldPromptConfigMigration: false,
          },
        },
      })
    );
    let current: ReturnType<typeof useProjectSettingsForm> | undefined;
    const Harness = ({ value }: { value: ProjectSettingsDomains }) => {
      current = useProjectSettingsForm({
        domains: value,
        remotes: [origin],
        configMigrations: [],
        onSuccess: vi.fn(),
        save,
        writeConfigToRepo: vi.fn(),
        migrateProjectConfig: vi.fn(),
      });
      return null;
    };

    await act(async () => root.render(createElement(Harness, { value: domains('setup A') })));
    act(() => current?.updateGitIdentity('baseRemote', 'origin'));
    await act(async () => root.render(createElement(Harness, { value: domains('setup C') })));
    await act(async () => current?.handleSave());

    expect(save).toHaveBeenCalledWith({
      gitIdentity: { stored: { baseRemote: 'origin' } },
    });
  });
});
