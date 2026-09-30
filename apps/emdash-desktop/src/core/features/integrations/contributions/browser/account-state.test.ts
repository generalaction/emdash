import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  openModal: vi.fn(),
  navigate: vi.fn(),
  setProjectView: vi.fn(),
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

import { ProviderAccountStateEmpty, type BlockingProviderAccountState } from './account-state';

describe.each([
  { providerId: 'github', providerName: 'GitHub' },
  { providerId: 'linear', providerName: 'Linear' },
])('provider account state ($providerId)', ({ providerId, providerName }) => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
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

  describe('ProviderAccountStateEmpty', () => {
    function renderState(state: BlockingProviderAccountState) {
      act(() => {
        root.render(
          React.createElement(ProviderAccountStateEmpty, {
            state,
            projectId: 'project-1',
            providerId,
            providerName,
          })
        );
      });
    }

    it('renders disabled as quiet text without buttons or error styling', () => {
      renderState({ kind: 'disabled', message: `${providerName} is disabled for this project.` });
      expect(container.textContent).toContain(`${providerName} is disabled for this project.`);
      expect(container.querySelector('button')).toBeNull();
      expect(container.querySelector('.text-foreground-error')).toBeNull();
    });

    it('renders connect with a provider connection affordance', () => {
      renderState({
        kind: 'connect',
        message: `Connect a ${providerName} account to get started.`,
      });
      expect(container.textContent).toContain(`Connect a ${providerName} account to get started.`);
      const button = [...container.querySelectorAll('button')].find((candidate) =>
        candidate.textContent?.includes(`Connect ${providerName}`)
      );
      expect(button).toBeDefined();

      act(() => {
        button!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
      expect(mocks.openModal).toHaveBeenCalledWith({ integration: providerId });
    });

    it('renders unresolvable fail-closed with a project-settings fix affordance', () => {
      renderState({
        kind: 'unresolvable',
        message: `The selected ${providerName} account is no longer connected.`,
      });
      expect(container.textContent).toContain(
        `The selected ${providerName} account is no longer connected.`
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
