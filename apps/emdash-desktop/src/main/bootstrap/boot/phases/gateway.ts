import { emdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { acpAgentStatusBridge } from '@main/core/acp/agent-status-bridge';
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
    installDesktopWire(createDesktopWireOptions(), context.ssh);
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

    acpAgentStatusBridge.initialize();
    tuiAgentStatusBridge.initialize();

    runInBackground('account-session', async () => {
      const result = await emdashAccountService.initialize();
      if (!result.success) {
        log.warn('Failed to load account session token:', result.error);
      }
    });
  },
};
