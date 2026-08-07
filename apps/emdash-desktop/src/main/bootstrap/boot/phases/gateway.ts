import { retry, retrySchedules } from '@emdash/shared/scheduling';
import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { conversationWireEvents } from '@core/features/conversations/node/event-host';
import { loadActiveAgentStatusConversationIds } from '@core/features/conversations/node/load-active-agent-status-conversation-ids';
import { renameConversation } from '@core/features/conversations/node/renameConversation';
import { acpAgentStatusBridge } from '@main/core/acp/agent-status-bridge';
import { setAgentStatusConversationEventPublisher } from '@main/core/agent-status/agent-status-service';
import { tuiAgentStatusBridge } from '@main/core/agent-status/tui-agent-status-bridge';
import type { DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { installDesktopWire } from '@main/gateway/desktop-wire';
import { createDesktopDevServerBridgeInstaller } from '@main/gateway/dev-server-bridge';
import { log } from '@main/lib/logger';
import { appScope } from '../../core/app-scope';
import { runInBackground } from '../../core/background';
import type { ControllersBundle } from './controllers';
import type { DatabaseBundle } from './database';
import type { ServicesBundle } from './services';

export function installGateway(
  controllers: ControllersBundle,
  database: DatabaseBundle,
  services: ServicesBundle,
  runtimes: DesktopRuntimes
): void {
  installDesktopWire(controllers);
  const installDevServerBridge = createDesktopDevServerBridgeInstaller(
    runtimes.broker,
    database.workspaceIdentity
  );
  runInBackground(
    'dev-server-bridge',
    () =>
      retry(() => installDevServerBridge(), {
        // Matches the former hand-rolled backoff: 1s doubling to 30s, three attempts.
        schedule: retrySchedules.exponential({ initialMs: 1_000, maxMs: 30_000, maxRetries: 2 }),
        signal: appScope.signal,
        shouldRetry: (error) => {
          // Only rate-limit (429) and server errors (5xx) are retryable;
          // errors without a status are treated as transient.
          const status = (error as { status?: number } | null)?.status;
          return status === undefined || status === 429 || status >= 500;
        },
        onRetry: ({ attempt, delayMs }) =>
          log.warn('Retrying dev-server bridge install after error', { attempt, delayMs }),
      }),
    {
      onError: (error) => log.warn('Failed to install dev-server bridge', { error }),
    }
  );

  acpAgentStatusBridge.initialize(
    (handler) => conversationEvents.on('conversation:created', handler),
    {
      runtimes: runtimes.broker,
      onLocalWorkerStateChanged: runtimes.workers.acp.onStateChanged.bind(runtimes.workers.acp),
      loadActiveConversationIds: (host) =>
        loadActiveAgentStatusConversationIds(database.db, host, 'acp'),
      renameConversation: (conversationId, name) =>
        renameConversation(
          {
            db: database.db,
            runtimes: runtimes.broker,
            hostIsReachable: services.hostIsReachable,
          },
          conversationId,
          name
        ),
    }
  );
  const publishConversationEvent = (event: Parameters<typeof conversationWireEvents.emit>[1]) =>
    conversationWireEvents.emit(undefined, event);
  setAgentStatusConversationEventPublisher(publishConversationEvent);
  tuiAgentStatusBridge.initialize({
    runtimes: runtimes.broker,
    onLocalWorkerStateChanged: runtimes.workers.tuiAgents.onStateChanged.bind(
      runtimes.workers.tuiAgents
    ),
    loadActiveConversationIds: (host) =>
      loadActiveAgentStatusConversationIds(database.db, host, 'pty'),
  });
  appScope.add(
    services.hostAttachments.register({
      label: 'acp-agent-status',
      attach: (host) => acpAgentStatusBridge.attachHost(host),
      detach: (host) => acpAgentStatusBridge.detachHost(host),
    })
  );
  appScope.add(
    services.hostAttachments.register({
      label: 'tui-agent-status',
      attach: (host) => tuiAgentStatusBridge.attachHost(host),
      detach: (host) => tuiAgentStatusBridge.detachHost(host),
    })
  );

  runInBackground('account-session', async () => {
    const result = await services.account.initialize();
    if (!result.success) {
      log.warn('Failed to load account session token:', result.error);
    }
  });
}
