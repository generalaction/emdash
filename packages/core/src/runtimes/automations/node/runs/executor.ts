import { randomUUID } from 'node:crypto';
import type { AutomationRun } from '../../api/run';
import type { AutomationPortError } from '../ports/port-error';
import type { AutomationSessionPort } from '../ports/session-start';
import type { AutomationWorkspacePort } from '../ports/workspace-provisioning';
import type { AutomationRunTransitions } from './transitions';

export type AutomationRunExecutorOptions = {
  transitions: AutomationRunTransitions;
  workspacePort: AutomationWorkspacePort;
  sessionPort: AutomationSessionPort;
  createConversationId?: () => string;
};

export type AutomationRunExecutor = (run: AutomationRun, signal: AbortSignal) => Promise<void>;

export function createAutomationRunExecutor(
  options: AutomationRunExecutorOptions
): AutomationRunExecutor {
  const { transitions, workspacePort, sessionPort, createConversationId = randomUUID } = options;

  return async (run: AutomationRun, signal: AbortSignal): Promise<void> => {
    const provisionResult = await workspacePort.provision({
      workspace: run.configSnapshot.workspace,
      generatedName: run.generatedName,
      signal,
    });

    if (!provisionResult.success) {
      transitions.markFailed(
        run.id,
        toRunError('provision_workspace', provisionResult.error),
        Date.now()
      );
      return;
    }

    const { workspace, branchName } = provisionResult.data;
    if (!transitions.markStartingSession(run.id, { workspace, branchName })) return;

    const conversationId = createConversationId();
    const startResult = await sessionPort.start({
      conversationId,
      cwd: workspace,
      agent: run.configSnapshot.agent,
      signal,
    });

    if (!startResult.success) {
      transitions.markFailed(run.id, toRunError('start_session', startResult.error), Date.now());
      return;
    }

    transitions.markDone(
      run.id,
      { conversationId, sessionId: startResult.data.sessionId },
      Date.now()
    );
  };
}

function toRunError(step: 'provision_workspace' | 'start_session', portError: AutomationPortError) {
  return { step, code: portError.code, message: portError.message };
}
