import { resourceUsageSampleSchema } from '@emdash/core/runtimes/resource-usage/api';
import type {
  DependencyStatus,
  HostDependencyError,
  InstallCommandOption,
  InstallMethod,
} from '@emdash/core/services/host-dependencies/api';
import {
  hostDependencyErrorSchema,
  hostDependencyOperationProgressSchema,
  hostDependencySnapshotSchema,
  installMethodSchema,
} from '@emdash/core/services/host-dependencies/api';
import type { Result } from '@emdash/shared';
import { resultSchema } from '@emdash/shared';
import {
  defineContract,
  liveJob,
  liveModel,
  liveState,
  mutation,
  procedure,
} from '@emdash/wire/rpc';
import { z } from 'zod';
import type { SshConfig, SshConnectionUsage } from '@core/primitives/ssh/api';

export type SaveMachineInput = Partial<Pick<SshConfig, 'id'>> &
  Omit<SshConfig, 'id'> & { password?: string; passphrase?: string };

export type MachineSystemDependencyTier = 'required' | 'recommended';

export type MachineSystemDependencyStatus = {
  id: string;
  name: string;
  tier: MachineSystemDependencyTier;
  status: DependencyStatus;
  path: string | null;
  installDocs?: string;
  installOptions: InstallCommandOption[];
};

export type InstallMachineSystemDependencyInput = {
  machineId?: string;
  id: string;
  method?: InstallMethod;
  elevate?: boolean;
};

export type InstallMachineSystemDependencyResult = Result<
  MachineSystemDependencyStatus,
  HostDependencyError
>;
export type InstallMachineSystemDependenciesInput = {
  machineId?: string;
  dependencies: Array<Omit<InstallMachineSystemDependencyInput, 'machineId'>>;
};
export type InstallMachineSystemDependenciesResult = Record<
  string,
  InstallMachineSystemDependencyResult
>;

const voidInput = z.void();
const hostInput = z.object({ machineId: z.string().min(1).optional() });
const systemDependencyInstallInput = z.object({
  id: z.string().min(1),
  method: installMethodSchema.optional(),
  elevate: z.boolean().optional(),
});
const systemDependencyInstallResult = resultSchema(
  z.custom<MachineSystemDependencyStatus>(),
  hostDependencyErrorSchema
);

export const machinesContract = defineContract({
  getMachines: procedure({ input: voidInput, output: z.array(z.custom<SshConfig>()) }),
  getMachineUsage: procedure({
    input: voidInput,
    output: z.custom<SshConnectionUsage>(),
  }),
  getMachineMetrics: procedure({
    input: hostInput,
    output: resourceUsageSampleSchema,
  }),
  systemDependencies: liveModel({
    key: hostInput,
    states: {
      current: liveState({ data: hostDependencySnapshotSchema }),
    },
    mutations: {
      refresh: mutation({
        input: z.void(),
        data: hostDependencySnapshotSchema,
        error: hostDependencyErrorSchema,
      }),
    },
  }),
  installSystemDependencies: liveJob({
    input: hostInput.extend({ dependencies: z.array(systemDependencyInstallInput).min(1) }),
    progress: hostDependencyOperationProgressSchema,
    result: z.record(z.string(), systemDependencyInstallResult),
    error: hostDependencyErrorSchema,
  }),
  saveMachine: procedure({
    input: z.custom<SaveMachineInput>(),
    output: z.custom<SshConfig>(),
  }),
  deleteMachine: procedure({
    input: z.object({ id: z.string() }),
    output: z.void(),
  }),
  renameMachine: procedure({
    input: z.object({ id: z.string(), name: z.string() }),
    output: z.void(),
  }),
});
