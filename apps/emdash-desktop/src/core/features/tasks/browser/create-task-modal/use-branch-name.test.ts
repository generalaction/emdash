import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BranchNameState } from './use-branch-name';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@core/features/settings/api/browser/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({
    value: { branchPrefix: 'khanhlc', appendRandomBranchSuffix: false },
  }),
}));
vi.mock('@core/features/source-control/api/browser/stores/source-control-selectors', () => ({
  getGitRepositoryStore: () => undefined,
}));

const { useBranchName } = await import('./use-branch-name');

let latest: BranchNameState | undefined;

function Probe() {
  latest = useBranchName({ taskName: 'fix-cart' });
  return null;
}

describe('useBranchName prefix toggle', () => {
  let dom: JSDOM;
  let root: Root;

  beforeEach(async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    root = createRoot(dom.window.document.getElementById('root') as HTMLDivElement);
    await act(async () => root.render(React.createElement(Probe)));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('prefixes the derived branch by default and drops the prefix when toggled off', () => {
    expect(latest?.usePrefix).toBe(true);
    expect(latest?.branchName).toBe('khanhlc/fix-cart');

    act(() => latest?.setUsePrefix(false));

    expect(latest?.branchName).toBe('fix-cart');
  });

  it('adds or strips the prefix on a user-edited branch name', () => {
    act(() => latest?.setBranchName('khanhlc/hotfix'));
    act(() => latest?.setUsePrefix(false));
    expect(latest?.branchName).toBe('hotfix');

    act(() => latest?.setUsePrefix(true));
    expect(latest?.branchName).toBe('khanhlc/hotfix');
  });
});
