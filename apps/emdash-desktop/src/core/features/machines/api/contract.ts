import { resourceUsageSampleSchema } from '@emdash/core/runtimes/resource-usage/api';
import type {
  DependencyStatus,
  HostDependencyError,
  InstallCommandOption,
  InstallMethod,
} from '@emdash/core/services/host-dependencies/api';
import {
  hostDependencyErrorSchema,
  installMethodSchema,
} from '@emdash/core/services/host-dependencies/api';
import type { Result } from '@emdash/shared';
import { resultSchema } from '@emdash/shared';
import { defineContract, procedure } from '@emdash/wire/rpc';
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
};

export type InstallMachineSystemDependencyResult = Result<
  MachineSystemDependencyStatus,
  HostDependencyError
>;

const voidInput = z.void();
const hostInput = z.object({ machineId: z.string().min(1).optional() });

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
  getMachineSystemDependencies: procedure({
    input: hostInput,
    output: z.array(z.custom<MachineSystemDependencyStatus>()),
  }),
  installMachineSystemDependency: procedure({
    input: hostInput.extend({
      id: z.string().min(1),
      method: installMethodSchema.optional(),
    }),
    output: resultSchema(z.custom<MachineSystemDependencyStatus>(), hostDependencyErrorSchema),
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
