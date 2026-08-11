import type { ProjectConfigState } from '@emdash/core/runtimes/workspace-registry/api';
import { createEventStreamHost } from '@emdash/wire/live';
import { cell, expose, flushStateTurn } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectConfigDomainsFromState } from '../../project-settings-page';
import { projectsWireContract } from '../../wire-contract';
import { ProjectSettingsStore } from './project-settings-store';

let configState: ReturnType<typeof cell<ProjectConfigState>>;
let getProjectSettingsPage: ReturnType<typeof vi.fn>;
let wire: ReturnType<typeof createProjectsWire> | undefined;

vi.mock('../client', () => ({
  getProjectsWireClient: async () => wire!.client,
}));

function projectConfig(setup: string): ProjectConfigState {
  return {
    workspaceId: 'repo-1',
    repositoryId: 'repo-1',
    resolved: {
      preservePatterns: { value: [], from: 'built-in' },
      setup: { value: setup, from: 'personal' },
      autoRunSetup: { value: true, from: 'built-in' },
      autoRunRun: { value: false, from: 'built-in' },
    },
    personalConfig: { scripts: { setup } },
    sources: {
      preservePatterns: [],
      prepare: [],
      setup: [],
      run: [],
      teardown: [],
      shellSetup: [],
    },
    legacyDesktopSettingsMigrated: true,
  };
}

function settingsPage(setup: string) {
  return {
    domains: {
      ...projectConfigDomainsFromState(projectConfig(setup), []),
      gitIdentity: { stored: {} },
      placement: {
        stored: {},
        layers: {
          hostWorktreeRoot: null,
          builtInWorktreeRoot: '/tmp/worktrees',
          homeDirectory: '/tmp',
        },
        resolved: {
          worktreeRoot: {
            value: '/tmp/worktrees',
            provenance: { kind: 'inferred' as const, from: 'built-in default' },
          },
        },
      },
    },
    configMigrations: [],
    shouldPromptConfigMigration: false,
  };
}

describe('ProjectSettingsStore project config live model', () => {
  beforeEach(() => {
    configState = cell(projectConfig('first setup'));
    getProjectSettingsPage = vi.fn(async () => ({
      success: true as const,
      data: settingsPage('first setup'),
    }));
    wire = createProjectsWire();
  });

  afterEach(async () => {
    await wire?.dispose();
    wire = undefined;
    vi.clearAllMocks();
  });

  it('updates renderer domain snapshots from live config without refetching the page', async () => {
    const store = new ProjectSettingsStore('project-1');
    await store.load();
    expect(store.domains?.lifecycle.personal.scripts?.setup).toBe('first setup');

    configState.set(projectConfig('second setup'));
    await waitFor(() => store.domains?.lifecycle.personal.scripts?.setup === 'second setup');

    expect(store.domains?.lifecycle.resolved.setup?.value).toBe('second setup');
    expect(getProjectSettingsPage).toHaveBeenCalledTimes(1);
    store.dispose();
  });
});

function createProjectsWire() {
  const events = createEventStreamHost(projectsWireContract.events);
  const projectConfigProvider = expose(projectsWireContract.projectConfig, {
    current: () => configState,
  });
  const projectListProvider = expose(projectsWireContract.projectList, {
    list: cell({ projects: [] }),
  });
  const creationProvider = expose(projectsWireContract.creation, {
    state: () => cell({ phase: 'error' as const, message: 'unused' }),
  });
  const directoryTreeProvider = expose(projectsWireContract.directoryTree, {
    tree: () => cell(undefined as never),
  });
  const testWire = createTestWire(projectsWireContract, {
    events,
    projectConfig: projectConfigProvider,
    projectList: projectListProvider,
    creation: creationProvider,
    directoryTree: directoryTreeProvider,
    getProjectSettingsPage,
    create: {
      run: async () => ({
        success: false as const,
        error: { type: 'unused', message: 'unused' },
      }),
    },
    delete: async () => ({ success: true as const, data: {} }),
  } as never);
  return {
    ...testWire,
    async dispose() {
      await testWire.dispose();
      events.dispose();
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushStateTurn();
    if (predicate()) return;
  }
  expect(predicate()).toBe(true);
}
