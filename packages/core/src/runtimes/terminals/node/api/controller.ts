import { createController } from '@emdash/wire';
import { terminalsContract } from '@runtimes/terminals/api';
import type { TerminalsRuntime } from '@runtimes/terminals/node/runtime/runtime';
import { terminalJobError } from '@runtimes/terminals/node/runtime/runtime';

export function createTerminalsController(runtime: TerminalsRuntime) {
  return createController(terminalsContract, {
    startTerminal: (input) => runtime.startTerminal(input),
    getShellAvailability: () => runtime.getShellAvailability(),
    runWorkflow: {
      run: (input, ctx) => runtime.runWorkflow(input, ctx),
      toError: terminalJobError,
    },
    workflows: runtime.workflowsHost,
    output: (key) => runtime.outputLog(key),
    sessions: runtime.sessionsHost,
    devServers: runtime.devServersHost,
    sendInput: ({ key, data }) => runtime.sendInput(key, data),
    resize: ({ key, cols, rows }) => runtime.resize(key, cols, rows),
    kill: ({ key }) => runtime.kill(key),
    killTmuxSessions: (input) => runtime.killTmuxSessions(input),
    listTmuxSessions: () => runtime.listTmuxSessions(),
    killScope: ({ workspace }) => runtime.killScope(workspace),
    detachScope: ({ workspace }) => runtime.detachScope(workspace),
  });
}
