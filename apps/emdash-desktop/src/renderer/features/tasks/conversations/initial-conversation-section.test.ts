import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useInitialConversationState,
  type InitialConversationState,
} from './initial-conversation-section';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getProjectSshConnectionId: vi.fn(),
  setProviderOverride: vi.fn(),
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectSshConnectionId: mocks.getProjectSshConnectionId,
}));

vi.mock('@renderer/features/library/prompts/use-prompt-library', () => ({
  usePromptLibrary: () => ({ value: [] }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: undefined }),
}));

vi.mock('@renderer/lib/components/agent-selector/agent-selector', () => ({
  AgentSelector: () => null,
}));

vi.mock('@renderer/lib/ui/shortcut', () => ({
  Shortcut: () => null,
}));

vi.mock('../components/issue-selector/issue-selector', () => ({
  ProviderLogo: () => null,
}));

vi.mock('../create-task-modal/use-prompt-file-drop', () => ({
  usePromptFileDrop: () => ({ isDragOver: false, dropHandlers: {} }),
}));

vi.mock('./add-context-popover', () => ({
  AddContextPopover: () => null,
}));

vi.mock('@renderer/lib/stores/use-agents', () => ({
  useAgents: () => ({ data: [] }),
}));

vi.mock('./use-effective-provider', () => ({
  useEffectiveProvider: () => ({
    providerId: 'claude',
    setProviderOverride: mocks.setProviderOverride,
    createDisabled: false,
  }),
}));

type InitialConversationOptions = Parameters<typeof useInitialConversationState>[3];

let latestState: InitialConversationState | undefined;

function Probe({
  projectId,
  options,
}: {
  projectId: string;
  options?: InitialConversationOptions;
}) {
  latestState = useInitialConversationState(projectId, undefined, false, options);
  return null;
}

describe('useInitialConversationState', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    latestState = undefined;
    mocks.getProjectSshConnectionId.mockReturnValue(undefined);

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

  async function renderProbe(projectId: string, options?: InitialConversationOptions) {
    await act(async () => {
      root.render(React.createElement(Probe, { projectId, options }));
    });
  }

  async function setPrompt(prompt: string) {
    await act(async () => {
      latestState?.setPrompt(prompt);
    });
  }

  it('resets the prompt by default when the project changes', async () => {
    await renderProbe('project-1');
    await setPrompt('Keep this for project one');

    expect(latestState?.prompt).toBe('Keep this for project one');

    await renderProbe('project-2');

    expect(latestState?.prompt).toBe('');
  });

  it('can preserve the prompt when the project changes', async () => {
    await renderProbe('project-1', { resetPromptOnProjectChange: false });
    await setPrompt('Keep this automation prompt');

    expect(latestState?.prompt).toBe('Keep this automation prompt');

    await renderProbe('project-2', { resetPromptOnProjectChange: false });

    expect(latestState?.prompt).toBe('Keep this automation prompt');
  });
});
