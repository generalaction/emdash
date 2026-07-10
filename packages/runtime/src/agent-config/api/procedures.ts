import type { AgentConfigRuntime } from '../runtime/runtime';

export function createAgentConfigProcedures(runtime: AgentConfigRuntime) {
  return {
    refreshAgents(input: { providerId?: string; refreshShellEnv?: boolean }) {
      return runtime.refreshAgents(input);
    },
    uninstallAgent(input: { providerId: string; strategy?: { kind: 'package-manager'; method?: string } | { kind: 'custom'; command: string } }) {
      return runtime.uninstallAgent(input.providerId, input.strategy);
    },
    startLogin(input: { providerId: string; methodId: string }) {
      return runtime.startLogin(input.providerId, input.methodId);
    },
    cancelLogin(input: { providerId: string }) {
      return runtime.cancelLogin(input.providerId);
    },
    sendLoginInput(input: { providerId: string; data: string }) {
      return runtime.sendLoginInput(input.providerId, input.data);
    },
    resizeLogin(input: { providerId: string; cols: number; rows: number }) {
      return runtime.resizeLogin(input.providerId, input.cols, input.rows);
    },
    markUrlHandled(input: { providerId: string; urlId: string }) {
      return runtime.markUrlHandled(input.providerId, input.urlId);
    },
    refreshAuthStatus(input: { providerId: string }) {
      return runtime.refreshAuthStatus(input.providerId);
    },
    saveMcpServer(input: { server: Parameters<AgentConfigRuntime['saveMcpServer']>[0] }) {
      return runtime.saveMcpServer(input.server);
    },
    removeMcpServer(input: { name: string }) {
      return runtime.removeMcpServer(input.name);
    },
    listMcpForAgent(input: { providerId: string }) {
      return runtime.listMcpForAgent(input.providerId);
    },
    installSkill(input: Parameters<AgentConfigRuntime['installSkill']>[0]) {
      return runtime.installSkill(input);
    },
    removeSkill(input: { name: string }) {
      return runtime.removeSkill(input.name);
    },
    createSkill(input: Parameters<AgentConfigRuntime['createSkill']>[0]) {
      return runtime.createSkill(input);
    },
  };
}

export type AgentConfigProcedures = ReturnType<typeof createAgentConfigProcedures>;

