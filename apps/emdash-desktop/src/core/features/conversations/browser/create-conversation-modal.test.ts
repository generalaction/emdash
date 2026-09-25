import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProviderSettings, type ProviderSettingsSnapshot } from '../api/provider-settings';
import { CreateConversationModal } from './create-conversation-modal';

// Representative Wire payloads: browser code receives metadata, not Node plugin behaviors.
const modelOptions = {
  claude: { 'opus[1m]': { name: 'Opus 5.5' }, haiku: { name: 'Haiku 4.5' } },
  codex: { 'gpt-6-sol': { name: '6 Sol' }, 'gpt-6-luna': { name: '6 Luna' } },
};

const mocks = vi.hoisted(() => ({
  providerId: 'claude',
  useChatUi: false,
  preferences: null as ProviderSettingsSnapshot | null,
  createConversation: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
  complete: vi.fn(),
  select: vi.fn(({ children }: { children?: ReactNode; value: string }) => children),
  confirm: vi.fn((_props: { onClick(): void }) => null),
}));

vi.mock('@core/features/agents/api/browser/use-agents', () => ({
  useAgents: () => ({
    data: Object.entries(modelOptions).map(([id, options]) => ({
      id,
      capabilities: {
        models: { kind: 'selectable', modelOptions: options },
        acp: { kind: 'supported' },
        autoApprove: { kind: 'supported' },
      },
    })),
  }),
}));
vi.mock('@core/features/agents/contributions/browser/agent-selector', () => ({
  AgentSelector: () => null,
}));
vi.mock('@core/features/conversations/contributions/browser/conversation-transport-toggle', () => ({
  ConversationTransportToggle: () => null,
}));
vi.mock('@core/features/conversations/api/browser/stores/conversation-registry', () => ({
  conversationRegistry: {
    get: () => ({ conversations: new Map(), createConversation: mocks.createConversation }),
  },
}));
vi.mock('@core/features/conversations/api/browser/use-effective-provider', () => ({
  useEffectiveProvider: () => ({ providerId: mocks.providerId, createDisabled: false }),
}));
vi.mock('@core/features/projects/api/browser/stores/project-selectors', () => ({
  getProjectSshConnectionId: () => null,
}));
vi.mock('@core/manifests/browser/project-availability-ui', () => ({
  projectAvailabilityUi: { getLiveActionDisabledReason: () => null },
}));
vi.mock('@core/manifests/browser/modal-api', () => ({
  useModalController: () => ({ complete: mocks.complete }),
}));
vi.mock('@core/primitives/modals/react/use-close-guard', () => ({
  useCloseGuard: () => {},
}));
vi.mock('@core/features/conversations/api/browser/provider-preferences', () => ({
  readProviderSettings: async () => mocks.preferences,
}));
vi.mock('@core/features/conversations/api/browser/use-conversation-launch-settings', () => ({
  useConversationLaunchSettings: () => ({
    ready: true,
    useChatUi: mocks.useChatUi,
    autoApprove: false,
    setUseChatUi: vi.fn(),
    setAutoApprove: vi.fn(),
  }),
}));
vi.mock('@core/primitives/keybindings/browser/confirm-button', () => ({
  ConfirmButton: mocks.confirm,
}));
vi.mock('@emdash/ui/react/primitives', () => {
  const container = ({ children }: { children?: ReactNode }) => children;
  return {
    Dialog: { Header: container, Title: container, Body: container, Footer: container },
    Field: { Root: container, Label: container, Group: container },
    Select: {
      Root: mocks.select,
      Trigger: container,
      Value: container,
      Content: container,
      Item: container,
    },
    Switch: () => null,
  };
});

beforeEach(() => {
  mocks.providerId = 'claude';
  mocks.useChatUi = true;
  mocks.preferences = structuredClone(emptyProviderSettings);
  vi.clearAllMocks();
});
async function createConversation() {
  renderToStaticMarkup(
    createElement(CreateConversationModal, { projectId: 'project', taskId: 'task' })
  );
  mocks.confirm.mock.lastCall![0].onClick();
  await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
}
describe('conversation creation settings', () => {
  it('inherits all explicit ACP options without a redundant model picker', async () => {
    const options = {
      model: 'outside-plugin-list',
      reasoning_effort: 'xhigh',
      mode: 'full-access',
      fast: true,
    };
    mocks.preferences!.acp.options = options;
    await createConversation();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'acp', options })
    );
  });
  it('starts without provider overrides when nothing was selected', async () => {
    await createConversation();
    expect(mocks.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'acp', options: {} })
    );
  });
  it('leaves native CLI model selection to the CLI when creating a TUI conversation', async () => {
    mocks.useChatUi = false;
    mocks.preferences!.acp.options = { model: 'chat-only' };
    await createConversation();
    expect(mocks.select).not.toHaveBeenCalled();
    const input = mocks.createConversation.mock.calls[0]?.[0] as { options?: unknown };
    expect(input).toMatchObject({ type: 'pty' });
    expect(input).not.toHaveProperty('model');
    expect(input.options).toBeUndefined();
  });
});
