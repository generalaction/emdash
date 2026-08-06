import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import {
  hostDependenciesContract,
  RECOMMENDED_CORE_DEPENDENCIES,
  REQUIRED_CORE_DEPENDENCIES,
  type HostDependencyError,
  type HostDependencySnapshot,
  type HostDependencyView,
} from '@emdash/core/services/host-dependencies/node';
import {
  runtimeResolveErrorAsError,
  type RuntimeBroker,
  type HostRuntimesClient,
} from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { createController, type Controller } from '@emdash/wire/api';
import type { MachinesService } from '@core/features/machines/api/node/machines-service';
import { runRuntimeLiveJob } from '@core/services/runtime-clients/node/live-job';
import type { InstallMachineSystemDependenciesResult, MachineSystemDependencyStatus } from '../api';
import { machinesContract } from '../api';

const requiredCoreDependencyIds = new Set(
  REQUIRED_CORE_DEPENDENCIES.map((definition) => definition.id)
);
const recommendedCoreDependencyIds = new Set(
  RECOMMENDED_CORE_DEPENDENCIES.map((definition) => definition.id)
);
const systemDependencyOrder = [...REQUIRED_CORE_DEPENDENCIES, ...RECOMMENDED_CORE_DEPENDENCIES].map(
  (definition) => definition.id
);
const systemDependencyIds = new Set(systemDependencyOrder);

export function createMachinesWireController(
  service: MachinesService,
  runtimes: RuntimeBroker
): Controller {
  return createController(machinesContract, {
    getMachines: () => service.getMachines(),
    getMachineUsage: () => service.getMachineUsage(),
    getMachineMetrics: async ({ machineId }) => {
      const runtime = await resolveMachineRuntime(runtimes, machineId);
      return await runtime.resourceUsage.sample(undefined);
    },
    getMachineSystemDependencies: async ({ machineId }) => {
      const runtime = await resolveMachineRuntime(runtimes, machineId);
      const snapshot = await refreshSystemDependencies(runtime);
      return mapSystemDependencySnapshot(snapshot);
    },
    installSystemDependencies: {
      run: async ({ machineId, dependencies }, context) => {
        const mapped: InstallMachineSystemDependenciesResult = {};
        const requests = dependencies.filter(({ id }) => {
          if (systemDependencyIds.has(id)) return true;
          mapped[id] = err({ type: 'unknown-dependency', id });
          return false;
        });
        if (requests.length === 0) return ok(mapped);

        const runtime = await resolveMachineRuntime(runtimes, machineId);
        const result = await runRuntimeLiveJob(
          hostDependenciesContract.runInstallBatch,
          runtime.hostDependencies.runInstallBatch,
          { requests },
          context.progress,
          { signal: context.signal }
        );
        if (!result.success) {
          for (const { id } of requests) mapped[id] = err(result.error);
          return ok(mapped);
        }
        for (const { id } of requests) {
          const entry = result.data[id];
          mapped[id] = !entry
            ? err({ type: 'io', message: `Install result missing for dependency: ${id}` })
            : entry.success
              ? ok(mapSystemDependencyView(entry.data))
              : err(entry.error);
        }
        return ok(mapped);
      },
      toError: (error) => ({
        type: 'io',
        message: error instanceof Error ? error.message : String(error),
      }),
    },
    saveMachine: (input) => service.saveMachine(input),
    deleteMachine: ({ id }) => service.deleteMachine(id),
    renameMachine: ({ id, name }) => service.renameMachine(id, name),
  });
}

async function resolveMachineRuntime(
  runtimes: RuntimeBroker,
  machineId?: string
): Promise<HostRuntimesClient> {
  const runtime = await runtimes.client(machineId ? hostRef('remote', machineId) : LOCAL_HOST_REF);
  if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
  return runtime.data;
}

async function refreshSystemDependencies(
  runtime: HostRuntimesClient
): Promise<HostDependencySnapshot> {
  const result = await runtime.hostDependencies.snapshot.mutate('refresh', {
    key: undefined,
    input: {},
  });
  if (!result.success) throw hostDependencyErrorAsError(result.error);
  return result.data.data;
}

function mapSystemDependencySnapshot(
  snapshot: HostDependencySnapshot
): MachineSystemDependencyStatus[] {
  const dependencies = snapshot.dependencies;
  return systemDependencyOrder
    .map((id) => dependencies[id])
    .filter((view): view is HostDependencyView => !!view)
    .map(mapSystemDependencyView);
}

function mapSystemDependencyView(view: HostDependencyView): MachineSystemDependencyStatus {
  return {
    id: view.definition.id,
    name: view.definition.name,
    tier: systemDependencyTier(view.definition.id),
    status: view.status,
    path: view.resolved?.path ?? null,
    ...(view.definition.installDocs ? { installDocs: view.definition.installDocs } : {}),
    installOptions: view.installOptions,
  };
}

function systemDependencyTier(id: string): MachineSystemDependencyStatus['tier'] {
  if (requiredCoreDependencyIds.has(id)) return 'required';
  if (recommendedCoreDependencyIds.has(id)) return 'recommended';
  return 'recommended';
}

function hostDependencyErrorAsError(error: HostDependencyError): Error {
  switch (error.type) {
    case 'unknown-dependency':
      return new Error(`Unknown dependency: ${error.id}`);
    case 'missing':
      return new Error(`Dependency is missing: ${error.id}`);
    case 'stale-selection':
      return new Error(`Selected dependency path no longer exists: ${error.path}`);
    case 'invalid-selection':
      return new Error(error.message);
    case 'no-install-command':
      return new Error(`No install command is available for ${error.id}`);
    case 'not-detected-after-install':
      return new Error(`Installed ${error.id}, but the binary was not detected on PATH.`);
    case 'no-update-command':
      return new Error(`No update command is available for ${error.id}`);
    case 'installer-missing':
      return new Error(`Installer is missing: ${error.tool}`);
    case 'permission-denied':
      return new Error(error.message);
    case 'command-failed':
      return new Error(error.message);
    case 'io':
      return new Error(error.message);
  }
}
