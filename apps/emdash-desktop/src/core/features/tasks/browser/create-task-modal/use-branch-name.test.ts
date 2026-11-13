import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BranchNameState } from './use-branch-name';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: { branchPrefix: 'app', appendRandomBranchSuffix: false } }),
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => undefined,
}));

// `durable` is null while the project settings page loads.
const settingsMock = vi.hoisted(() => ({
  durable: null as { gitIdentity: { stored: { branchPrefix?: string } } } | null,
  error: undefined as string | undefined,
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSettingsStore: () => ({
    durableDomains: settingsMock.durable,
    pageData: { error: settingsMock.error },
  }),
}));

const { useBranchName } = await import('./use-branch-name');

let latest: BranchNameState | undefined;

function Probe() {
  latest = useBranchName({ taskName: 'Fix login', projectId: 'project-1' });
  return null;
}

describe('useBranchName project prefix', () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(() => {
    latest = undefined;
    settingsMock.durable = null;
    settingsMock.error = undefined;
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    root = createRoot(dom.window.document.getElementById('root') as HTMLDivElement);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  const render = () =>
    act(async () => {
      root.render(React.createElement(Probe));
    });

  it('marks the generated name as pending while the project settings load', async () => {
    await render();
    expect(latest?.branchPrefixPending).toBe(true);

    settingsMock.durable = { gitIdentity: { stored: { branchPrefix: 'proj' } } };
    await render();
    expect(latest?.branchPrefixPending).toBe(false);
    expect(latest?.branchName.startsWith('proj/')).toBe(true);
  });

  it('falls back to the app prefix when the project settings fail to load', async () => {
    settingsMock.error = 'Failed to load project settings';
    await render();
    expect(latest?.branchPrefixPending).toBe(false);
    expect(latest?.branchName.startsWith('app/')).toBe(true);
  });

  it('does not wait for the settings once the user types a branch name', async () => {
    await render();
    await act(async () => latest?.setBranchName('my-branch'));
    expect(latest?.branchName).toBe('my-branch');
    expect(latest?.branchPrefixPending).toBe(false);
  });
});
