import type { AcpProcessHost } from '@emdash/core/acp';
import type {
  AgentHostAcpSpawn,
  AgentHostError,
  ResolvedAcpProvider,
} from '@emdash/core/agents/plugins';
import { pluginRegistry } from '@emdash/plugins/agents';
import { AcpRuntime, type AcpAgentHost } from '@emdash/runtime/acp-agents';
import { err, ok, type Result } from '@emdash/shared';
import { appScope } from '@main/app/app-scope';
import { acpProcessHostManager } from '@main/core/acp/transport/acp-process-host-manager';
import { machineKey, type MachineRef } from '@main/core/runtime/types';

class TargetAcpAgentHost implements AcpAgentHost {
  constructor(private readonly processHost: AcpProcessHost) {}

  resolveAcp(providerId: string): ResolvedAcpProvider | null {
    const plugin = pluginRegistry.get(providerId);
    if (!plugin || plugin.capabilities.acp.kind !== 'supported' || !plugin.behavior.acp) {
      return null;
    }
    return { behavior: plugin.behavior.acp };
  }

  async buildAcpSpawn(
    providerId: string,
    ctx: { cwd: string; env?: Record<string, string> }
  ): Promise<Result<AgentHostAcpSpawn, AgentHostError>> {
    const provider = this.resolveAcp(providerId);
    if (!provider) {
      return err({ type: 'capability-unsupported', providerId, capability: 'acp' });
    }

    try {
      const spawnContext = await this.processHost.resolveSpawnContext(providerId);
      const spawn = provider.behavior.buildSpawn({
        cwd: ctx.cwd,
        cli: spawnContext.cli,
        env: spawnContext.agentEnv,
      });
      return ok({
        ...spawn,
        cwd: ctx.cwd,
        env: { ...spawnContext.agentEnv, ...spawn.env, ...(ctx.env ?? {}) },
      });
    } catch (error) {
      return err({
        type: 'invalid-state',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const runtimeScope = appScope.child('loop-acp-runtime');
const runtimes = new Map<string, Promise<AcpRuntime>>();

export function getLoopAcpRuntime(machine: MachineRef): Promise<AcpRuntime> {
  const key = machineKey(machine);
  const existing = runtimes.get(key);
  if (existing) return existing;

  const created = createRuntime(machine).catch((error) => {
    runtimes.delete(key);
    throw error;
  });
  runtimes.set(key, created);
  return created;
}

async function createRuntime(machine: MachineRef): Promise<AcpRuntime> {
  const processHost = await acpProcessHostManager.get(machine);
  const runtime = new AcpRuntime({
    agentHost: new TargetAcpAgentHost(processHost),
    host: processHost,
    logger: runtimeScope.log,
    resolveAttachment: async () => {
      throw new Error('Loop ACP sessions do not support prompt attachments');
    },
  });
  runtimeScope.add(() => runtime.dispose());
  return runtime;
}
