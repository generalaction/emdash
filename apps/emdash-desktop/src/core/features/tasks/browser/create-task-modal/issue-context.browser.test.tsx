import { hostRefKey, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { integrationPluginRegistry } from '@emdash/plugins/integrations';
import { deferred, type Deferred } from '@emdash/shared/testing';
import { createInProcessWire, defineContract } from '@emdash/wire/rpc';
import '@emdash/ui/style.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { emptyProviderSettings } from '@core/features/conversations/api/provider-settings';
import {
  PROVIDER_ACCOUNTS_QUERY_KEY,
  ISSUE_CONNECTION_STATUS_QUERY_KEY,
  invalidateProviderAccountState,
} from '@core/features/integrations/api/browser/use-provider-accounts';
import { integrationsContract } from '@core/features/integrations/api/contract';
import {
  IntegrationsProvider,
  INTEGRATION_PROVIDERS_QUERY_KEY,
} from '@core/features/integrations/contributions/browser/integrations-provider';
import { issuesContract, issuesDomain } from '@core/features/issues/api/contract';
import { appSettingsMetaQueryKey } from '@core/features/settings/api/browser/app-settings-client';
import {
  InitialConversationField,
  type InitialConversationState,
} from '@core/features/tasks/contributions/browser/task-config/initial-conversation-section';
import { TaskConfigPanel } from '@core/features/tasks/contributions/browser/task-config/task-config-panel';
import type { ConnectionStatusMap, IssueContextResult } from '@core/primitives/issue-providers/api';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import type { ProviderAccountsByProvider } from '@core/primitives/provider-accounts/api';
import { ThemeProvider } from '@core/primitives/theme/browser';
import { resetWireConnection, seedWireConnection } from '@core/primitives/wire/browser/connection';
import { useLinkedIssueContext } from '../issue-context/use-linked-issue-context';
import { buildInitialConversation } from './build-create-task-params';
import { IssueComboboxField } from './issue-combobox-field';
import { useBranchName } from './use-branch-name';

const ticket: LinkedIssue = {
  provider: 'youtrack',
  accountId: 'youtrack-account',
  identifier: 'ENG-123',
  title: 'Fix authentication',
  url: 'https://team.youtrack.cloud/issue/ENG-123',
  description: 'Summary only',
};
const otherTicket: LinkedIssue = {
  ...ticket,
  identifier: 'ENG-124',
  title: 'Fix reconnect',
  url: 'https://team.youtrack.cloud/issue/ENG-124',
};
const detail: LinkedIssue = {
  ...ticket,
  description: 'FULL DESCRIPTION',
  context: 'Ada: Keep the original account.',
};
let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;
let handle: { dispose: () => Promise<void> };
let responses: Deferred<IssueContextResult>[];
let accountInventory: Deferred<ProviderAccountsByProvider> | undefined;
let requests: unknown[];
let launched: ReturnType<typeof buildInitialConversation>;
let currentState: InitialConversationState;
let clearSelection: () => void;
let selectIssue: (issue: LinkedIssue) => void;

function Probe({
  useChatUi,
  theme = 'emlight',
  includeContext = true,
}: {
  useChatUi: boolean;
  theme?: 'emlight' | 'emdark';
  includeContext?: boolean;
}) {
  const [selected, setSelected] = useState<LinkedIssue | null>(null);
  const resolved = useLinkedIssueContext(selected, undefined, includeContext);
  const branch = useBranchName({ taskName: 'Fix authentication', linkedIssue: resolved.issue });
  const [prompt, setPrompt] = useState('');
  const [issueContext, setIssueContext] = useState<string | null>(null);
  const state: InitialConversationState = {
    provider: 'claude',
    setProvider: () => {},
    prompt,
    setPrompt,
    issueContext,
    setIssueContext,
    autoApprove: false,
    setAutoApprove: () => {},
    issueContextEditorOpen: false,
    setIssueContextEditorOpen: () => {},
    settingsReady: true,
    settings: emptyProviderSettings,
    options: {},
    setOption: () => {},
    flushSettings: async () => {},
    model: null,
    setModel: () => {},
    useChatUi,
    setUseChatUi: () => {},
    initialPromptSupported: true,
    issueMentionContexts: {},
    setIssueMentionContext: () => {},
  };
  currentState = state;
  clearSelection = () => setSelected(null);
  selectIssue = setSelected;
  return (
    <ThemeProvider theme={theme} onThemeChange={() => {}}>
      <h1>YouTrack ticket task</h1>
      <IssueComboboxField value={resolved.issue} onValueChange={setSelected} />
      <TaskConfigPanel
        tabs={[
          {
            value: 'conversation',
            label: 'Initial Conversation',
            content: (
              <InitialConversationField
                state={state}
                linkedIssue={resolved.issue ?? undefined}
                includeIssueContextByDefault={includeContext}
                showAutoApproveToggle={false}
              />
            ),
          },
          {
            value: 'workspace',
            label: 'Workspace Settings',
            content: (
              <label>
                Branch name
                <input
                  aria-label="Branch name"
                  value={branch.branchName}
                  onChange={(event) => branch.setBranchName(event.target.value)}
                />
              </label>
            ),
          },
        ]}
      />
      {resolved.isLoading && <p role="status">Loading ticket context…</p>}
      {resolved.error && <p role="alert">{resolved.error}</p>}
      {resolved.error && (
        <button type="button" onClick={resolved.retry}>
          Retry
        </button>
      )}
      <button
        type="button"
        disabled={resolved.isLoading || !!resolved.error}
        onClick={() => {
          launched = buildInitialConversation(state);
        }}
      >
        Create task
      </button>
    </ThemeProvider>
  );
}

beforeEach(() => {
  const integration = integrationPluginRegistry.get('youtrack');
  if (!integration) throw new Error('Missing YouTrack integration');
  requests = [];
  responses = [deferred<IssueContextResult>(), deferred<IssueContextResult>()];
  accountInventory = undefined;
  launched = undefined;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const capabilities = { requiresRepositoryUrl: false, supportsIssueContext: true };
  queryClient.setQueryData(INTEGRATION_PROVIDERS_QUERY_KEY, [
    {
      ...integration.metadata,
      features: ['issues'],
      auth: integration.capabilities.auth,
      icon: integration.assets.icon,
      issueCapabilities: capabilities,
    },
  ]);
  queryClient.setQueryData(PROVIDER_ACCOUNTS_QUERY_KEY, {
    youtrack: [{ accountId: ticket.accountId, isDefault: true, displayName: 'Ada' }],
  });
  queryClient.setQueryData(ISSUE_CONNECTION_STATUS_QUERY_KEY, {
    youtrack: { connected: true, capabilities },
  });
  queryClient.setQueryData(['promptLibrary'], []);
  const projectSettings = { branchPrefix: 'emdash', appendRandomBranchSuffix: false };
  queryClient.setQueryData(appSettingsMetaQueryKey('project'), {
    value: projectSettings,
    defaults: projectSettings,
    overrides: {},
  });
  queryClient.setQueryData(
    ['agents', 'metadata', hostRefKey(LOCAL_HOST_REF)],
    [
      {
        id: 'claude',
        name: 'Claude Code',
        icon: integration.assets.icon,
        capabilities: {
          acp: { kind: 'supported' },
          prompt: { kind: 'argv' },
          autoApprove: { kind: 'none' },
          models: { kind: 'none' },
        },
      },
    ]
  );
  queryClient.setQueryData(
    ['agents', 'status', hostRefKey(LOCAL_HOST_REF)],
    [
      {
        id: 'claude',
        status: 'available',
      },
    ]
  );
  const wire = createInProcessWire(
    defineContract({
      [issuesDomain]: defineContract({
        listIssues: issuesContract.listIssues,
        searchIssues: issuesContract.searchIssues,
        getIssueContext: issuesContract.getIssueContext,
        checkAllConnections: issuesContract.checkAllConnections,
      }),
      integrations: defineContract({ listAccounts: integrationsContract.listAccounts }),
    }),
    {
      [issuesDomain]: {
        listIssues: async () => ({ success: true, data: [ticket, otherTicket] }),
        searchIssues: async () => ({ success: true, data: [ticket, otherTicket] }),
        getIssueContext: async (input: unknown) => {
          const response = responses[requests.length];
          requests.push(input);
          if (!response) throw new Error('Unexpected context request');
          return response.promise;
        },
        checkAllConnections: async () => {
          const statuses = queryClient.getQueryData<ConnectionStatusMap>(
            ISSUE_CONNECTION_STATUS_QUERY_KEY
          );
          if (!statuses) throw new Error('Missing connection status fixture');
          return statuses;
        },
      },
      integrations: {
        listAccounts: async () => (accountInventory ? accountInventory.promise : {}),
      },
    },
    { validate: 'full' }
  );
  resetWireConnection();
  seedWireConnection(async () => wire.connection);
  handle = {
    dispose: async () => {
      resetWireConnection();
      await wire.dispose();
    },
  };
  container = document.createElement('div');
  container.style.width = '520px';
  container.style.padding = '24px';
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  flushSync(() => root.unmount());
  queryClient.clear();
  container.remove();
  await handle.dispose();
});

function render(useChatUi = true, theme: 'emlight' | 'emdark' = 'emlight', includeContext = true) {
  flushSync(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <IntegrationsProvider>
          <Probe useChatUi={useChatUi} theme={theme} includeContext={includeContext} />
        </IntegrationsProvider>
      </QueryClientProvider>
    )
  );
}

async function chooseTicket() {
  await page.getByText('Select a', { exact: true }).click();
  await page.getByRole('option', { name: new RegExp(ticket.title) }).click();
  await expect.poll(() => requests.length).toBe(1);
}

describe('ticket selection to initial agent context', () => {
  it.each([true, false])(
    'includes full context for ACP=%s and preserves typed instructions',
    async (useChatUi) => {
      render(useChatUi);
      await chooseTicket();
      await expect.element(page.getByRole('button', { name: 'Create task' })).toBeDisabled();
      flushSync(() => currentState.setPrompt(`${currentState.prompt}Implement the fix.`));
      responses[0]?.resolve({ success: true, data: detail });
      await expect.poll(() => currentState.issueContext).toContain('FULL DESCRIPTION');
      await page.getByRole('button', { name: 'Create task' }).click();
      const payload = JSON.stringify(launched);
      expect(payload).toContain('FULL DESCRIPTION');
      expect(payload).toContain('Identifier: ENG-123');
      expect(payload).toContain('Keep the original account.');
      expect(payload).toContain('Implement the fix.');
      expect(requests[0]).toMatchObject({
        provider: 'youtrack',
        options: {
          identifier: ticket.identifier,
          accountId: ticket.accountId,
          issueUrl: ticket.url,
        },
      });
    }
  );

  it('creates a ticket-only ACP prompt using the real mention editor', async () => {
    render();
    await chooseTicket();
    responses[0]?.resolve({ success: true, data: detail });
    await expect.poll(() => currentState.issueContext).toContain('FULL DESCRIPTION');
    await page.getByRole('button', { name: 'Create task' }).click();
    expect(launched?.initialQueue?.[0]?.text).toContain('issue:v1:');
    expect(launched?.initialQueue?.[0]?.hiddenContext).toContain('Keep the original account.');
  });

  it('ignores a response for a previous selection', async () => {
    render();
    await chooseTicket();
    flushSync(() => selectIssue(otherTicket));
    await expect.poll(() => requests.length).toBe(2);
    responses[1]?.resolve({
      success: true,
      data: { ...otherTicket, context: 'NEW TICKET COMMENT' },
    });
    await expect.poll(() => currentState.issueContext).toContain('NEW TICKET COMMENT');
    responses[0]?.resolve({ success: true, data: detail });
    await page.getByRole('button', { name: 'Create task' }).click();
    expect(JSON.stringify(launched)).toContain('NEW TICKET COMMENT');
    expect(JSON.stringify(launched)).not.toContain('Keep the original account.');
  });

  it('does not reuse context for the same ticket ID from a different installation account', async () => {
    render();
    await chooseTicket();
    const otherAccount = {
      ...ticket,
      accountId: 'other-account',
      url: 'https://other.youtrack.cloud/issue/ENG-123',
    };
    flushSync(() => selectIssue(otherAccount));
    await expect.poll(() => requests.length).toBe(2);
    responses[1]?.resolve({ success: true, data: { ...otherAccount, context: 'OTHER INSTANCE' } });
    await expect.poll(() => currentState.issueContext).toContain('OTHER INSTANCE');
    responses[0]?.resolve({ success: true, data: detail });
    await page.getByRole('button', { name: 'Create task' }).click();
    expect(JSON.stringify(launched)).toContain('OTHER INSTANCE');
    expect(JSON.stringify(launched)).not.toContain('Keep the original account.');
  });

  it('keeps context edits when details finish loading', async () => {
    render();
    await chooseTicket();
    flushSync(() => currentState.setIssueContext('My edited ticket instructions'));
    responses[0]?.resolve({ success: true, data: detail });
    await expect.element(page.getByRole('button', { name: 'Create task' })).toBeEnabled();
    expect(currentState.issueContext).toBe('My edited ticket instructions');
  });

  it('hydrates context on the workspace tab without resetting an edited branch', async () => {
    render();
    await chooseTicket();
    await page.getByRole('tab', { name: 'Workspace Settings' }).click();
    await page.getByRole('textbox', { name: 'Branch name' }).fill('my-edited-branch');
    responses[0]?.resolve({ success: true, data: { ...detail, url: `${ticket.url}#comments` } });
    await expect.poll(() => currentState.issueContext).toContain('FULL DESCRIPTION');
    await expect
      .element(page.getByRole('textbox', { name: 'Branch name' }))
      .toHaveValue('my-edited-branch');
    await page.getByRole('button', { name: 'Create task' }).click();
    expect(JSON.stringify(launched)).toContain('Keep the original account.');
  });

  it('preserves context opt-out when switching away from and back to the conversation tab', async () => {
    render();
    await chooseTicket();
    await page.getByTestId('prompt-editor').fill('Work without ticket context.');
    await page.getByRole('tab', { name: 'Workspace Settings' }).click();
    responses[0]?.resolve({ success: true, data: detail });
    await expect.element(page.getByRole('button', { name: 'Create task' })).toBeEnabled();
    await page.getByRole('tab', { name: 'Initial Conversation' }).click();
    expect(currentState.issueContext).toBeNull();
    expect(currentState.prompt).toBe('Work without ticket context.');
  });

  it.each([false, true])(
    'blocks account revalidation before inventory refresh, with stale cache=%s',
    async (alreadyStale) => {
      render();
      await chooseTicket();
      responses[0]?.resolve({ success: true, data: detail });
      await expect.poll(() => currentState.issueContext).toContain('FULL DESCRIPTION');
      if (alreadyStale) {
        queryClient.setQueryData(
          [
            'issues:context',
            undefined,
            ticket.provider,
            ticket.accountId,
            ticket.identifier,
            ticket.url,
          ],
          detail,
          { updatedAt: Date.now() - 60_001 }
        );
      }
      accountInventory = deferred<ProviderAccountsByProvider>();
      const refreshed = invalidateProviderAccountState(queryClient);
      await expect.poll(() => requests.length).toBe(2);
      await expect.element(page.getByRole('button', { name: 'Create task' })).toBeDisabled();
      responses[1]?.resolve({
        success: false,
        error: { type: 'auth_required', message: 'The captured account was removed.' },
      });
      accountInventory.resolve({});
      await refreshed;
      await expect
        .element(page.getByRole('alert'))
        .toHaveTextContent('The captured account was removed.');
      await expect.element(page.getByRole('button', { name: 'Create task' })).toBeDisabled();
    }
  );

  it('skips retrieval when default ticket context is disabled', async () => {
    render(true, 'emlight', false);
    await page.getByText('Select a', { exact: true }).click();
    await page.getByRole('option', { name: new RegExp(ticket.title) }).click();
    await expect.element(page.getByRole('button', { name: 'Create task' })).toBeEnabled();
    expect(requests).toHaveLength(0);
    expect(currentState.issueContext).toBeNull();
  });

  it.each([true, false])(
    'keeps a removed mention excluded from ACP=%s context',
    async (useChatUi) => {
      render(useChatUi);
      await chooseTicket();
      await page.getByTestId('prompt-editor').fill('Work without ticket context.');
      await expect.poll(() => currentState.issueContext).toBeNull();
      responses[0]?.resolve({ success: true, data: detail });
      await expect.element(page.getByRole('button', { name: 'Create task' })).toBeEnabled();
      await page.getByRole('button', { name: 'Create task' }).click();
      expect(JSON.stringify(launched)).not.toContain('FULL DESCRIPTION');
      expect(JSON.stringify(launched)).not.toContain('Keep the original account.');
    }
  );

  it('shows detail failures and retrieves context on explicit retry', async () => {
    render();
    await chooseTicket();
    responses[0]?.resolve({
      success: false,
      error: { type: 'host_unreachable', message: 'YouTrack is unavailable.' },
    });
    await expect.element(page.getByRole('alert')).toHaveTextContent('YouTrack is unavailable.');
    await expect.element(page.getByRole('button', { name: 'Create task' })).toBeDisabled();
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    responses[1]?.resolve({ success: true, data: detail });
    await expect.poll(() => currentState.issueContext).toContain('FULL DESCRIPTION');
    await expect.element(page.getByRole('button', { name: 'Create task' })).toBeEnabled();
  });

  it('ignores a response after clearing the linked ticket', async () => {
    render();
    await chooseTicket();
    flushSync(clearSelection);
    responses[0]?.resolve({ success: true, data: detail });
    await expect.poll(() => currentState.issueContext).toBeNull();
    expect(currentState.prompt).not.toContain('issue:v1:');
  });

  it.each(['emlight', 'emdark'] as const)(
    'renders the official YouTrack logo and linked ticket in %s',
    async (theme) => {
      render(true, theme);
      await chooseTicket();
      responses[0]?.resolve({ success: true, data: detail });
      await expect.poll(() => currentState.issueContext).toContain('FULL DESCRIPTION');
      await expect.element(page.getByRole('img', { name: 'YouTrack' }).first()).toBeVisible();
      await expect.element(page.getByText('ENG-123', { exact: true }).first()).toBeVisible();
      await page.screenshot();
    }
  );
});
