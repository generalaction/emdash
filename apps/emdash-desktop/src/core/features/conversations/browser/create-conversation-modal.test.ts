import { formatHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderPreferencesState } from '../contributions/mementos';
import { CreateConversationModal } from './create-conversation-modal';
import {
  patchProviderPreference,
  providerPreference,
  type ConversationTransport,
} from './provider-preferences';

// Representative Wire payloads: browser code receives metadata, not Node plugin behaviors.
const modelOptions = {
  claude: { 'opus[1m]': { name: 'Opus 5.5' }, haiku: { name: 'Haiku 4.5' } },
  codex: { 'gpt-6-sol': { name: '6 Sol' }, 'gpt-6-luna': { name: '6 Luna' } },
};

const mocks = vi.hoisted(() => ({
  providerId: 'claude',
  useChatUi: false,
  preferences: { version: '1', entries: {} } as ProviderPreferencesState,
  createConversation: vi.fn().mockResolvedValue(undefined),
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
vi.mock('@core/features/tasks/api/browser/hooks/useTaskSettings', () => ({
  useTaskSettings: () => ({ autoApproveByDefault: false }),
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
vi.mock('@core/primitives/react-hooks/browser/useLocalStorage', () => ({
  useLocalStorage: () => [mocks.useChatUi, vi.fn()],
}));
vi.mock('@core/primitives/mementos/react', () => ({
  useMemento: () => [
    mocks.preferences,
    (update: (current: ProviderPreferencesState) => ProviderPreferencesState) => {
      mocks.preferences = update(mocks.preferences);
    },
  ],
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

const host = formatHostRef(LOCAL_HOST_REF);

beforeEach(() => {
  mocks.providerId = 'claude';
  mocks.useChatUi = false;
  mocks.preferences = { version: '1', entries: {} };
  vi.clearAllMocks();
});

async function createConversation(
  providerId: string,
  transport: ConversationTransport,
  model?: string
) {
  mocks.providerId = providerId;
  mocks.useChatUi = transport === 'acp';
  if (model !== undefined) {
    mocks.preferences = patchProviderPreference(mocks.preferences, host, providerId, transport, {
      model,
    });
  }
  renderToStaticMarkup(
    createElement(CreateConversationModal, { projectId: 'project', taskId: 'task' })
  );
  mocks.confirm.mock.lastCall![0].onClick();
  await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
}

describe('new conversation model selection', () => {
  it.each(Object.entries(modelOptions))(
    'passes advertised %s models to chat creation',
    async (providerId, options) => {
      for (const model of Object.keys(options)) {
        vi.clearAllMocks();
        await createConversation(providerId, 'acp', model);
        expect(mocks.select.mock.lastCall![0].value).toBe(model);
        expect(mocks.createConversation).toHaveBeenCalledWith(
          expect.objectContaining({ provider: providerId, type: 'acp', model })
        );
        expect(providerPreference(mocks.preferences, host, providerId, 'acp').model).toBe(model);
      }
    }
  );

  it.each([
    ['claude', 'pty', 'claude-haiku-4-5'],
    ['codex', 'pty', 'gpt-5.4-mini'],
    // A static list cannot determine which models a user's live ACP catalog offers.
    ['codex', 'acp', 'gpt-5.4-mini'],
  ] as const)(
    'preserves a saved %s %s model outside the static list',
    async (providerId, transport, model) => {
      await createConversation(providerId, transport, model);
      expect(mocks.select.mock.lastCall![0].value).toBe(model);
      expect(mocks.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({ provider: providerId, type: transport, model })
      );
      expect(providerPreference(mocks.preferences, host, providerId, transport).model).toBe(model);
    }
  );

  it('leaves the model unspecified when there is no saved preference', async () => {
    await createConversation('claude', 'acp');
    expect(mocks.select.mock.lastCall![0].value).toBe('');
    expect(mocks.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ model: undefined })
    );
  });
});
