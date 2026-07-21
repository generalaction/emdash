import { conversationEvents } from '@core/features/conversations/api/node/conversation-events';
import { conversationWireEvents } from '@core/features/conversations/node/event-host';
import { setSessionId } from '@core/features/conversations/node/set-session-id';
import { acpAgentStatusBridge } from '@main/core/acp/agent-status-bridge';
import { setAgentStatusConversationEventPublisher } from '@main/core/agent-status/agent-status-service';
import { tuiAgentStatusBridge } from '@main/core/agent-status/tui-agent-status-bridge';
import { installDesktopWire } from '@main/gateway/desktop-wire';
import {
  agentConfigWorker,
  ensureAcpWorkerReady,
  ensureAutomationsWorkerReady,
  ensureFileSearchWorkerReady,
  ensureFilesWorkerReady,
  ensureGitWorkerReady,
  ensureMementosWorkerReady,
  ensurePullRequestsWorkerReady,
  ensureTerminalsWorkerReady,
  ensureTuiAgentsWorkerReady,
  ensureWorkspaceWorkerReady,
} from '@main/gateway/desktop-workers';
import { installDevServerBridge } from '@main/gateway/dev-server-bridge';
import { configureRemoteRuntimes } from '@main/gateway/runtime-broker';
import { log } from '@main/lib/logger';
import { withRetry } from '@main/lib/retry';
import { appScope } from '../../core/app-scope';
import { runInBackground } from '../../core/background';
import type { Phase } from '../../core/phase';
import type { BootContext } from '../types';
import { createDesktopWireOptions } from '../wiring';

export const gatewayPhase: Phase<BootContext> = {
  name: 'gateway',
  run(context) {
    if (!context.ssh) {
      throw new Error('SSH service was not initialized before the gateway phase');
    }
    if (!context.workspaceServer) {
      throw new Error('Workspace-server service was not initialized before the gateway phase');
    }
    appScope.add(configureRemoteRuntimes(context.workspaceServer));
    installDesktopWire(createDesktopWireOptions(context), context.ssh, context.workspaceServer);
    runInBackground(
      'dev-server-bridge',
      () => withRetry(installDevServerBridge, { signal: appScope.signal }),
      {
        onError: (error) => log.warn('Failed to install dev-server bridge', { error }),
      }
    );

    runInBackground('acp-runtime', ensureAcpWorkerReady);
    runInBackground('agent-config-runtime', () => agentConfigWorker.ready());
    runInBackground('files-runtime', ensureFilesWorkerReady);
    runInBackground('file-search-runtime', ensureFileSearchWorkerReady);
    runInBackground('git-runtime', ensureGitWorkerReady);
    runInBackground('mementos-runtime', ensureMementosWorkerReady);
    runInBackground('terminals-runtime', ensureTerminalsWorkerReady);
    runInBackground('tui-agents-runtime', ensureTuiAgentsWorkerReady);
    runInBackground('workspace-runtime', ensureWorkspaceWorkerReady);
    runInBackground('automations-runtime', ensureAutomationsWorkerReady);
    runInBackground('pull-requests-runtime', ensurePullRequestsWorkerReady);

    acpAgentStatusBridge.initialize((handler) =>
      conversationEvents.on('conversation:created', handler)
    );
    const publishConversationEvent = (event: Parameters<typeof conversationWireEvents.emit>[1]) =>
      conversationWireEvents.emit(undefined, event);
    setAgentStatusConversationEventPublisher(publishConversationEvent);
    const db = context.db;
    if (!db) throw new Error('App database was not initialized before the gateway phase');
    tuiAgentStatusBridge.initialize({
      setSessionId: (conversationId, sessionId) => setSessionId(conversationId, sessionId, db),
      publishConversationEvent,
    });

    runInBackground('account-session', async () => {
      if (!context.accountService) {
        throw new Error('Account service was not initialized before the gateway phase');
      }
      const result = await context.accountService.initialize();
      if (!result.success) {
        log.warn('Failed to load account session token:', result.error);
      }
    });
  },
};
