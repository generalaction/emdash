import type { AcpRuntimeListener } from '@emdash/core/acp';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { isAppFocused } from '@main/core/agent-hooks/notification';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { setSessionId } from '@main/core/conversations/set-session-id';
import { updateConversationModel } from '@main/core/conversations/updateConversationModel';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  acpPermissionRequestChannel,
  acpPermissionResolvedChannel,
  acpSessionClosedChannel,
  acpSessionStateChannel,
  acpSessionUpdateChannel,
  acpTurnCommittedChannel,
} from '@shared/core/acp/acpEvents';
import { agentSessionExitedChannel, type AgentEvent } from '@shared/core/agents/agentEvents';
import { AcpSessionManager } from './acp-session-manager';
import { acpProcessHostManager } from './transport/acp-process-host-manager';

const listener: AcpRuntimeListener = {
  onState: ({ conversationId, lifecycle, activeTurnId }) => {
    events.emit(acpSessionStateChannel, { conversationId, lifecycle, activeTurnId });
  },
  onSessionUpdate: ({ conversationId, turnId, update, seq }) => {
    events.emit(acpSessionUpdateChannel, { conversationId, turnId, update, seq });
  },
  onTurnCommitted: ({ conversationId, turn }) => {
    events.emit(acpTurnCommittedChannel, { conversationId, turn });
  },
  onPermissionRequest: (request) => {
    events.emit(acpPermissionRequestChannel, request);
  },
  onPermissionResolved: ({ conversationId, requestId }) => {
    events.emit(acpPermissionResolvedChannel, { conversationId, requestId });
  },
  onClosed: ({ conversationId, taskId, exitCode }) => {
    events.emit(acpSessionClosedChannel, { conversationId, exitCode });
    events.emit(agentSessionExitedChannel, { conversationId, taskId });
  },
  onAgentEvent: ({ type, conversationId, projectId, taskId, providerId }) => {
    const event: AgentEvent = {
      type,
      source: 'hook',
      providerId,
      projectId,
      taskId,
      conversationId,
      timestamp: Date.now(),
      payload: {},
    };
    agentHookService.emitAgentEvent(event, isAppFocused());
  },
};

export const acpSessionManager = new AcpSessionManager({
  getPlugin,
  acquireProcessHost: (machine) => acpProcessHostManager.get(machine),
  listener,
  setSessionId,
  updateConversationModel,
  log,
});
