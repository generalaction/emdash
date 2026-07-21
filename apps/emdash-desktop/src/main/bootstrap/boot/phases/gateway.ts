import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { conversationWireEvents } from '@core/features/conversations/node/event-host';
import { setSessionId } from '@core/features/conversations/node/set-session-id';
import { acpAgentStatusBridge } from '@main/core/acp/agent-status-bridge';
import { setAgentStatusConversationEventPublisher } from '@main/core/agent-status/agent-status-service';
import { tuiAgentStatusBridge } from '@main/core/agent-status/tui-agent-status-bridge';
import type { DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { installDesktopWire } from '@main/gateway/desktop-wire';
import { createDesktopDevServerBridgeInstaller } from '@main/gateway/dev-server-bridge';
import { log } from '@main/lib/logger';
import { withRetry } from '@main/lib/retry';
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
    () => withRetry(installDevServerBridge, { signal: appScope.signal }),
    {
      onError: (error) => log.warn('Failed to install dev-server bridge', { error }),
    }
  );

  acpAgentStatusBridge.initialize(
    (handler) => conversationEvents.on('conversation:created', handler),
    {
      client: runtimes.clients.acp,
      onStateChanged: runtimes.workers.acp.onStateChanged.bind(runtimes.workers.acp),
    }
  );
  const publishConversationEvent = (event: Parameters<typeof conversationWireEvents.emit>[1]) =>
    conversationWireEvents.emit(undefined, event);
  setAgentStatusConversationEventPublisher(publishConversationEvent);
  tuiAgentStatusBridge.initialize({
    client: runtimes.clients.tuiAgents,
    onStateChanged: runtimes.workers.tuiAgents.onStateChanged.bind(runtimes.workers.tuiAgents),
    setSessionId: (conversationId, sessionId) =>
      setSessionId(conversationId, sessionId, database.db),
    publishConversationEvent,
  });

  runInBackground('account-session', async () => {
    const result = await services.account.initialize();
    if (!result.success) {
      log.warn('Failed to load account session token:', result.error);
    }
  });
}
