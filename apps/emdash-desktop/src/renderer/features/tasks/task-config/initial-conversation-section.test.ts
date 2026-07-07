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
  chatUiFeature: true,
}));

vi.mock('@emdash/ui/react/components', () => ({
  ChatComposer: () => null,
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectSshConnectionId: mocks.getProjectSshConnectionId,
  asMounted: vi.fn(() => undefined),
  getProjectStore: vi.fn(() => undefined),
  getProjectViewStore: vi.fn(() => undefined),
}));

vi.mock('@renderer/features/integrations/integration-icon', () => ({
  IntegrationIcon: () => null,
}));

vi.mock('@renderer/features/integrations/use-connected-issue-providers', () => ({
  useConnectedIssueProviders: () => ({
    connectedProviders: [],
    hasAnyIssueIntegration: false,
    isProviderUsable: () => false,
    isCheckingConnections: false,
  }),
}));

vi.mock('@renderer/features/library/prompts/use-prompt-library', () => ({
  usePromptLibrary: () => ({ value: [] }),
}));

vi.mock('@renderer/lib/components/agent-selector/agent-selector', () => ({
  AgentSelector: () => null,
}));

vi.mock('../components/issue-selector/issue-selector', () => ({
  ProviderLogo: () => null,
}));

vi.mock('../create-task-modal/use-prompt-file-drop', () => ({
  usePromptFileDrop: () => ({ isDragOver: false, dropHandlers: {} }),
}));

vi.mock('../context-bar/add-context-popover', () => ({
  AddContextPopover: () => null,
}));

vi.mock('@renderer/lib/stores/use-agents', () => ({
  useAgents: () => ({ data: [] }),
}));

vi.mock('@renderer/lib/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => mocks.chatUiFeature,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    issues: {
      searchIssues: vi.fn(),
      getIssueContext: vi.fn(),
    },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { warn: vi.fn() },
}));

vi.mock('@renderer/features/conversations/use-effective-provider', () => ({
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

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost',
    });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Event', dom.window.Event);
    vi.stubGlobal('localStorage', dom.window.localStorage);
    dom.window.localStorage.clear();

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

  it('defaults chat UI on when the provider supports ACP', async () => {
    await renderProbe('project-1');

    expect(latestState?.useChatUi).toBe(true);
  });

  it('persists when chat UI is disabled', async () => {
    await renderProbe('project-1');

    await act(async () => {
      latestState?.setUseChatUi(false);
    });

    expect(dom.window.localStorage.getItem('initial-conversation:chat-ui-enabled')).toBe('false');

    await renderProbe('project-2');

    expect(latestState?.useChatUi).toBe(false);
  });
});
