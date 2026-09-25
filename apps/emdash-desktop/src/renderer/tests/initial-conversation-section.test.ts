import { formatHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { ChatComposerProps, PromptEditorRef } from '@emdash/ui/react/components';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutomationFormState } from '@core/features/automations/browser/useAutomationFormState';
import { useAutomationSettingsAutoSave } from '@core/features/automations/browser/useAutomationSettingsAutoSave';
import { patchProviderSettings } from '@core/features/conversations/api/browser/provider-preferences';
import type {
  ProviderPreferencePatch,
  ProviderSettingsSnapshot,
} from '@core/features/conversations/api/provider-settings';
import {
  InitialConversationField,
  useInitialConversationState,
  type InitialConversationState,
} from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import type { Automation } from '@core/primitives/automations/api';
import { issueMentionToken } from '@core/primitives/issues/api/issue-context';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getProjectSshConnectionId: vi.fn(),
  setProviderOverride: vi.fn(),
  editorText: '',
  editorApi: {
    focus: vi.fn(),
    clear: vi.fn(),
    getText: vi.fn(() => mocks.editorText),
    setText: vi.fn((text: string) => {
      mocks.editorText = text;
    }),
    insertMention: vi.fn(),
    prependMention: vi.fn(),
    removeMention: vi.fn(),
    setMentionPending: vi.fn(),
  },
  lastChatComposerProps: null as unknown,
  updateAutomation: vi.fn(async () => {}),
  autoApproveKind: 'supported',
  preferences: { version: '1', entries: {} } as {
    version: string;
    entries: Record<string, ProviderSettingsSnapshot>;
  },
}));

vi.mock('@core/features/tasks/api/browser/create-task-modal/use-project-git-context', () => ({
  useProjectGitContext: () => ({ defaultBranch: 'main', hasRepository: true }),
}));
vi.mock('@core/features/tasks/api/browser/create-task-modal/use-task-name', () => ({
  useTaskName: () => ({ effectiveTaskName: 'Review changes' }),
}));
vi.mock('@core/features/tasks/api/browser/create-task-modal/use-workspace-config', () => ({
  useWorkspaceConfig: () => ({
    isValid: true,
    resolvedConfig: {
      version: '2',
      git: { kind: 'none' },
      workspace: { kind: 'repository-instance', workspaceId: 'workspace-1' },
    },
  }),
}));
vi.mock('@core/features/automations/browser/use-automations', () => ({
  useUpdateAutomation: () => ({ mutateAsync: mocks.updateAutomation }),
  useAutomationTargetAvailability: () => ({ data: { available: true } }),
}));

vi.mock('@core/features/conversations/api/browser/provider-preferences', async () => {
  const { useSyncExternalStore } = await import('react');
  const { emptyProviderSettings } =
    await import('@core/features/conversations/api/provider-settings');
  const listeners = new Set<() => void>();
  const key = (scope: { host: string; providerId: string }) =>
    JSON.stringify([scope.host, scope.providerId]);
  const read = (scope: { host: string; providerId: string }) =>
    mocks.preferences.entries[key(scope)] ?? emptyProviderSettings;
  const write = (scope: { host: string; providerId: string }, value: ProviderSettingsSnapshot) => {
    mocks.preferences = {
      version: '1',
      entries: { ...mocks.preferences.entries, [key(scope)]: value },
    };
    for (const listener of listeners) listener();
  };
  return {
    useProviderSettings: (scope: { host: string; providerId: string } | null) => {
      const settings = useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        () => (scope ? read(scope) : emptyProviderSettings)
      );
      return { settings, ready: true };
    },
    readProviderSettings: async (scope: { host: string; providerId: string }) => read(scope),
    patchProviderSettings: async (
      scope: { host: string; providerId: string },
      patch: ProviderPreferencePatch
    ) => {
      const settings = read(scope);
      write(
        scope,
        patch.transport === 'acp'
          ? {
              ...settings,
              acp: { ...settings.acp, options: { ...settings.acp.options, ...patch.options } },
            }
          : { ...settings, pty: { ...settings.pty, autoApprove: patch.autoApprove } }
      );
    },
    setPreferredTransport: async (
      scope: { host: string; providerId: string },
      transport: 'acp' | 'pty'
    ) => write(scope, { ...read(scope), transport }),
  };
});

vi.mock('@emdash/ui/react/components', () => ({
  ChatComposer: (props: unknown) => {
    mocks.lastChatComposerProps = props;
    const { editorApiRef } = props as { editorApiRef?: React.Ref<PromptEditorRef> };
    if (typeof editorApiRef === 'function') {
      editorApiRef(mocks.editorApi as unknown as PromptEditorRef);
    } else if (editorApiRef) {
      editorApiRef.current = mocks.editorApi as unknown as PromptEditorRef;
    }
    return null;
  },
}));

vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSshConnectionId: mocks.getProjectSshConnectionId,
  asAvailableProject: vi.fn(() => ({})),
  firstAvailableProjectId: () => 'project-1',
  projectData: () => ({ repositoryWorkspaceId: 'workspace-1' }),
  getProjectStore: vi.fn(() => undefined),
  getProjectViewStore: vi.fn(() => undefined),
}));

vi.mock('@core/features/integrations/contributions/browser/integration-icon', () => ({
  IntegrationIcon: () => null,
}));

vi.mock('@core/features/integrations/api/browser/use-connected-issue-providers', () => ({
  useConnectedIssueProviders: () => ({
    connectedProviders: [],
    hasAnyIssueIntegration: false,
    isProviderUsable: () => false,
    isCheckingConnections: false,
  }),
}));

vi.mock('@core/features/library/api/browser/prompts/use-prompt-library', () => ({
  usePromptLibrary: () => ({ value: [] }),
}));

vi.mock('@core/features/agents/contributions/browser/agent-selector', () => ({
  AgentSelector: () => null,
}));

vi.mock('@core/features/tasks/browser/components/issue-selector/issue-selector', () => ({
  ProviderLogo: () => null,
}));

vi.mock('@core/features/tasks/browser/create-task-modal/use-prompt-file-drop', () => ({
  usePromptFileDrop: () => ({ isDragOver: false, dropHandlers: {} }),
}));

vi.mock('@core/features/tasks/browser/context-bar/add-context-popover', () => ({
  AddContextPopover: () => null,
}));

vi.mock('@core/features/agents/api/browser/use-agents', () => ({
  useAgents: () => ({
    data: [
      {
        id: 'claude',
        capabilities: {
          acp: { kind: 'supported' },
          autoApprove: { kind: mocks.autoApproveKind },
          models: { kind: 'none' },
        },
      },
    ],
  }),
}));

vi.mock('@core/primitives/logging/browser/logger', () => ({
  log: { warn: vi.fn() },
}));

vi.mock('@core/features/conversations/api/browser/use-effective-provider', () => ({
  useEffectiveProvider: () => ({
    providerId: 'claude',
    setProviderOverride: mocks.setProviderOverride,
    createDisabled: false,
  }),
}));

type InitialConversationOptions = Parameters<typeof useInitialConversationState>[2];

let latestState: InitialConversationState | undefined;

function Probe({
  projectId,
  options,
}: {
  projectId: string;
  options?: InitialConversationOptions;
}) {
  latestState = useInitialConversationState(projectId, undefined, options);
  return null;
}

let latestAutomation: ReturnType<typeof useAutomationFormState> | undefined;
function AutomationCreateProbe() {
  latestAutomation = useAutomationFormState();
  return null;
}
function AutomationEditProbe({ automation }: { automation: Automation }) {
  latestAutomation = useAutomationSettingsAutoSave(automation).formState;
  return null;
}

function FieldProbe({
  linkedIssue,
  includeIssueContextByDefault = false,
  placeholder,
}: {
  linkedIssue?: LinkedIssue;
  includeIssueContextByDefault?: boolean;
  placeholder?: string;
}) {
  const state = useInitialConversationState('project-1');
  return React.createElement(InitialConversationField, {
    state,
    linkedIssue,
    includeIssueContextByDefault,
    placeholder,
  });
}

function chatComposerProps(): ChatComposerProps {
  if (!mocks.lastChatComposerProps) {
    throw new Error('ChatComposer was not rendered');
  }
  return mocks.lastChatComposerProps as ChatComposerProps;
}

describe('useInitialConversationState', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    latestState = undefined;
    mocks.preferences = { version: '1', entries: {} };
    mocks.editorText = '';
    mocks.lastChatComposerProps = null;
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

  it('persists the auto-approve preference', async () => {
    await renderProbe('project-1');

    await act(async () => {
      latestState?.setAutoApprove(true);
    });

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderProbe('project-2');

    expect(latestState?.autoApprove).toBe(true);
  });

  it('reflects active-chat preference changes immediately in an already-open creation form', async () => {
    await renderProbe('project-1');
    await act(async () => {
      await patchProviderSettings(
        { host: formatHostRef(LOCAL_HOST_REF), providerId: 'claude' },
        {
          transport: 'pty',
          autoApprove: true,
        }
      );
    });
    expect(latestState?.autoApprove).toBe(true);
    await act(async () => latestState?.setAutoApprove(false));
    expect(latestState?.autoApprove).toBe(false);
    await act(async () => {
      await patchProviderSettings(
        { host: formatHostRef(LOCAL_HOST_REF), providerId: 'claude' },
        {
          transport: 'acp',
          options: { model: 'sonnet' },
        }
      );
    });
    expect(latestState?.autoApprove).toBe(false);
    expect(Object.values(mocks.preferences.entries)[0]?.acp.options).toEqual({ model: 'sonnet' });
  });

  it('starts new scopes off and isolates hosts and transports', async () => {
    await renderProbe('project-1');
    expect(latestState?.autoApprove).toBe(false);
    await act(async () => latestState?.setAutoApprove(true));
    await act(async () => latestState?.setUseChatUi(true));
    expect(latestState?.autoApprove).toBe(false);
    await act(async () => latestState?.setAutoApprove(true));

    mocks.getProjectSshConnectionId.mockReturnValue('remote-1');
    await renderProbe('project-2');
    expect(latestState?.autoApprove).toBe(false);
    mocks.getProjectSshConnectionId.mockReturnValue(undefined);
    await renderProbe('project-1');
    expect(latestState?.autoApprove).toBe(false);
    await act(async () => latestState?.setUseChatUi(false));
    expect(latestState?.autoApprove).toBe(true);
  });

  it('ignores the retired global localStorage auto-approve preference', async () => {
    dom.window.localStorage.setItem('initial-conversation:auto-approve-enabled', 'true');
    await renderProbe('project-1');
    expect(latestState?.autoApprove).toBe(false);
  });

  it('keeps new automation drafts independent and requires opt-in for each', async () => {
    await renderProbe('project-1');
    await act(async () => latestState?.setAutoApprove(true));
    const preferences = mocks.preferences;
    await act(async () => root.unmount());
    root = createRoot(container);
    const options = { launchSettings: { autoApprove: false, useChatUi: false } };
    await renderProbe('project-1', options);
    expect(latestState?.autoApprove).toBe(false);
    await act(async () => latestState?.setAutoApprove(true));
    expect(latestState?.autoApprove).toBe(true);
    expect(mocks.preferences).toBe(preferences);
    expect(dom.window.localStorage.getItem('initial-conversation:chat-ui-enabled')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderProbe('project-1', options);
    expect(latestState?.autoApprove).toBe(false);
  });

  it('edits saved automation policy without changing interactive preferences', async () => {
    const options = { launchSettings: { autoApprove: true, useChatUi: false } };
    await renderProbe('project-1', options);
    expect(latestState?.autoApprove).toBe(true);
    expect(latestState?.useChatUi).toBe(false);
    await act(async () => latestState?.setAutoApprove(false));
    expect(latestState?.autoApprove).toBe(false);
    expect(mocks.preferences.entries).toEqual({});
  });

  it('serializes automation opt-in and autosaves edits without changing interactive preferences', async () => {
    dom.window.localStorage.setItem('initial-conversation:chat-ui-enabled', 'true');
    await act(async () => root.render(React.createElement(AutomationCreateProbe)));
    expect(latestAutomation?.initialConversation.autoApprove).toBe(false);
    expect(latestAutomation?.initialConversation.useChatUi).toBe(false);
    await act(async () => {
      latestAutomation?.initialConversation.setPrompt('Review changes');
      latestAutomation?.initialConversation.setAutoApprove(true);
    });
    const config = latestAutomation?.buildConversationConfig();
    expect(config).toMatchObject({
      autoApprove: true,
      type: 'pty',
    });
    expect(mocks.preferences.entries).toEqual({});
    const automation: Automation = {
      id: 'automation-1',
      name: 'Review',
      projectId: 'project-1',
      enabled: true,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
      conversationConfig: config!,
      triggerConfig: { expr: '0 9 * * *', tz: 'UTC' },
      taskConfig: {
        version: '1',
        taskConfig: { version: '1', name: 'Review' },
        workspaceConfig: {
          version: '2',
          git: { kind: 'none' },
          workspace: { kind: 'repository-instance', workspaceId: 'workspace-1' },
        },
      },
    };
    await act(async () => root.render(React.createElement(AutomationEditProbe, { automation })));
    expect(latestAutomation?.initialConversation.autoApprove).toBe(true);
    mocks.updateAutomation.mockClear();
    await act(async () => latestAutomation?.initialConversation.setAutoApprove(false));
    expect(mocks.updateAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          conversationConfig: expect.objectContaining({ autoApprove: false, type: 'pty' }),
        }),
      })
    );
    expect(mocks.preferences.entries).toEqual({});
  });

  it('defaults chat UI off when the provider supports ACP', async () => {
    await renderProbe('project-1');

    expect(latestState?.useChatUi).toBe(false);
  });

  it('never exposes auto-approval for chat UI', async () => {
    mocks.autoApproveKind = 'unsupported';
    try {
      await renderProbe('project-1');
      await act(async () => latestState?.setAutoApprove(true));
      expect(latestState?.autoApprove).toBe(false);

      await act(async () => latestState?.setUseChatUi(true));
      expect(latestState?.autoApprove).toBe(false);
      await act(async () => latestState?.setAutoApprove(true));
      expect(latestState?.autoApprove).toBe(false);

      await act(async () => latestState?.setUseChatUi(false));
      expect(latestState?.autoApprove).toBe(false);
    } finally {
      mocks.autoApproveKind = 'supported';
    }
  });

  it('persists after the user enables chat UI', async () => {
    await renderProbe('project-1');

    await act(async () => {
      latestState?.setUseChatUi(true);
    });

    expect(Object.values(mocks.preferences.entries)[0]?.transport).toBe('acp');

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderProbe('project-2');

    expect(latestState?.useChatUi).toBe(true);
  });
});

describe('InitialConversationField', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    latestState = undefined;
    mocks.preferences = { version: '1', entries: {} };
    mocks.editorText = '';
    mocks.lastChatComposerProps = null;
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

  async function renderField(props: React.ComponentProps<typeof FieldProbe> = {}) {
    await act(async () => {
      root.render(React.createElement(FieldProbe, props));
    });
    await act(async () => {});
  }

  it('disables @ mention search while preserving slash commands and placeholder override', async () => {
    await renderField();

    const props = chatComposerProps();
    expect(props.mentionProvider).toBeUndefined();
    expect(props.onMentionInsert).toBeUndefined();
    expect(props.queryMentions).toBeUndefined();
    expect(props.queryCommands).toEqual(expect.any(Function));
    expect(props.placeholder).not.toContain('@');
  });

  it('forwards automation placeholder text without enabling @ mentions', async () => {
    await renderField({ placeholder: 'Add a prompt to the automation...' });

    const props = chatComposerProps();
    expect(props.placeholder).toBe('Add a prompt to the automation...');
    expect(props.mentionProvider).toBeUndefined();
  });

  it('preserves the selected linked issue pill', async () => {
    const linkedIssue: LinkedIssue = {
      provider: 'linear',
      identifier: 'ENG-123',
      displayIdentifier: 'ENG-123',
      title: 'Fix flaky tests',
      url: 'https://linear.app/emdash/issue/ENG-123/fix-flaky-tests',
    };

    await renderField({ linkedIssue, includeIssueContextByDefault: true });

    expect(mocks.editorApi.prependMention).toHaveBeenCalledWith(
      expect.objectContaining({
        id: issueMentionToken('linear', 'ENG-123', linkedIssue),
        label: issueMentionToken('linear', 'ENG-123', linkedIssue),
        name: 'ENG-123',
        kind: 'issue',
        description: 'Fix flaky tests',
      })
    );
  });

  it('renders provider icons for every issue mention', async () => {
    const linkedIssue: LinkedIssue = {
      provider: 'linear',
      identifier: 'ENG-123',
      displayIdentifier: 'ENG-123',
      title: 'Fix flaky tests',
      url: 'https://linear.app/emdash/issue/ENG-123/fix-flaky-tests',
    };

    await renderField({ linkedIssue, includeIssueContextByDefault: true });

    const renderMentionIcon = chatComposerProps().renderMentionIcon;
    const firstIcon = renderMentionIcon?.({
      id: 'issue:linear:ENG-123',
      label: 'issue:linear:ENG-123',
      kind: 'issue',
    });
    const secondIcon = renderMentionIcon?.({
      id: 'issue:linear:ENG-456',
      label: 'issue:linear:ENG-456',
      kind: 'issue',
    });

    expect(firstIcon).toMatchObject({ props: { provider: 'linear' } });
    expect(secondIcon).toMatchObject({ props: { provider: 'linear' } });
  });
});
