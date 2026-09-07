import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  useEffectiveSettings: vi.fn(),
  useGitHubAccounts: vi.fn(),
  openModal: vi.fn(),
  navigate: vi.fn(),
  setProjectView: vi.fn(),
}));

vi.mock('@core/features/projects/api/browser/effective-settings/use-effective-settings', () => ({
  useEffectiveSettings: mocks.useEffectiveSettings,
}));

vi.mock('@core/features/github/api/browser/useGithubAccounts', () => ({
  useGitHubAccounts: mocks.useGitHubAccounts,
}));

vi.mock('@core/manifests/browser/modal-api', () => ({
  useOpenModal: () => mocks.openModal,
}));

vi.mock('@core/primitives/navigation/browser/navigation-hooks', () => ({
  useNavigate: () => ({ navigate: mocks.navigate }),
}));

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectViewStore: () => ({ setProjectView: mocks.setProjectView }),
}));

vi.mock('@core/features/projects/contributions/views', () => ({
  projectViewDef: (params: unknown) => ({ view: 'project', params }),
}));

import {
  GitHubAccountStateEmpty,
  useBlockingGitHubAccountState,
  type BlockingGitHubAccountState,
} from '@core/features/github/contributions/browser/account-state';

function githubAccount(provenance: unknown, value: unknown = null) {
  return {
    baseRemote: { value: 'origin', provenance: { kind: 'inferred', from: 'origin remote' } },
    pushRemote: { value: 'origin', provenance: { kind: 'inferred', from: 'base remote' } },
    defaultBranch: { value: null, provenance: { kind: 'unresolvable' } },
    githubAccount: { value, provenance },
    worktreeRoot: { value: '/wt', provenance: { kind: 'inferred', from: 'built-in default' } },
  };
}

describe('github account state', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.useGitHubAccounts.mockReturnValue({ data: [] });
    mocks.useEffectiveSettings.mockReturnValue(null);

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Event', dom.window.Event);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  function HookProbe({ projectId }: { projectId?: string }) {
    const state = useBlockingGitHubAccountState(projectId);
    return React.createElement('span', { 'data-testid': 'state' }, state ? state.kind : 'none');
  }

  function probedState(projectId = 'project-1'): string {
    act(() => {
      root.render(React.createElement(HookProbe, { projectId }));
    });
    return container.querySelector('[data-testid="state"]')?.textContent ?? '';
  }

  describe('useBlockingGitHubAccountState', () => {
    it('is null while resolver inputs are loading', () => {
      mocks.useEffectiveSettings.mockReturnValue(null);
      expect(probedState()).toBe('none');
    });

    it('is null when resolution produced an account', () => {
      mocks.useEffectiveSettings.mockReturnValue(
        githubAccount({ kind: 'set' }, { accountId: 'github.com:42' })
      );
      expect(probedState()).toBe('none');
    });

    it('reports the quiet disabled row for explicit none', () => {
      mocks.useEffectiveSettings.mockReturnValue(githubAccount({ kind: 'set' }));
      expect(probedState()).toBe('disabled');
    });

    it('reports the connect row for inferred-absent with zero accounts', () => {
      mocks.useEffectiveSettings.mockReturnValue(
        githubAccount({ kind: 'inferred', from: 'no host-matching account' })
      );
      mocks.useGitHubAccounts.mockReturnValue({ data: [] });
      expect(probedState()).toBe('connect');
    });

    it('is null (silent default) for inferred-absent with accounts connected', () => {
      mocks.useEffectiveSettings.mockReturnValue(
        githubAccount({ kind: 'inferred', from: 'no host-matching account' })
      );
      mocks.useGitHubAccounts.mockReturnValue({ data: [{ accountId: 'github.com:42' }] });
      expect(probedState()).toBe('none');
    });

    it('fails closed on an unresolvable pin', () => {
      mocks.useEffectiveSettings.mockReturnValue(githubAccount({ kind: 'unresolvable' }));
      mocks.useGitHubAccounts.mockReturnValue({ data: [{ accountId: 'github.com:42' }] });
      expect(probedState()).toBe('unresolvable');
    });
  });

  describe('GitHubAccountStateEmpty', () => {
    function renderState(state: BlockingGitHubAccountState) {
      act(() => {
        root.render(
          React.createElement(GitHubAccountStateEmpty, { state, projectId: 'project-1' })
        );
      });
    }

    it('renders disabled as quiet text without buttons or error styling', () => {
      renderState({ kind: 'disabled', message: 'GitHub is disabled for this project.' });
      expect(container.textContent).toContain('GitHub is disabled for this project.');
      expect(container.querySelector('button')).toBeNull();
      expect(container.querySelector('.text-foreground-error')).toBeNull();
    });

    it('renders connect with a Connect GitHub affordance', () => {
      renderState({ kind: 'connect', message: 'Connect a GitHub account to get started.' });
      expect(container.textContent).toContain('Connect a GitHub account to get started.');
      const button = [...container.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes('Connect GitHub')
      );
      expect(button).toBeDefined();

      act(() => {
        button!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
      expect(mocks.openModal).toHaveBeenCalled();
    });

    it('renders unresolvable fail-closed with a project-settings fix affordance', () => {
      renderState({
        kind: 'unresolvable',
        message: 'The selected GitHub account is no longer connected.',
      });
      expect(container.textContent).toContain(
        'The selected GitHub account is no longer connected.'
      );
      expect(container.querySelector('.text-foreground-error')).not.toBeNull();
      const button = [...container.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes('Open project settings')
      );
      expect(button).toBeDefined();

      act(() => {
        button!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
      expect(mocks.navigate).toHaveBeenCalledWith({
        view: 'project',
        params: { projectId: 'project-1' },
      });
      expect(mocks.setProjectView).toHaveBeenCalledWith('settings');
    });
  });
});
