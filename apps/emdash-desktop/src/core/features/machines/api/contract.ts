import { defineContract, procedure } from '@emdash/wire/api';
import { z } from 'zod';
import type { SshConfig, SshConnectionUsage } from '@core/primitives/ssh/api';

export type SaveMachineInput = Partial<Pick<SshConfig, 'id'>> &
  Omit<SshConfig, 'id'> & { password?: string; passphrase?: string };

const voidInput = z.void();

export const machinesContract = defineContract({
  getMachines: procedure({ input: voidInput, output: z.array(z.custom<SshConfig>()) }),
  getMachineUsage: procedure({
    input: voidInput,
    output: z.custom<SshConnectionUsage>(),
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
