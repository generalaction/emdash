import { defineContract, eventStream, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  ConnectionState,
  ConnectionTestResult,
  SshConfig,
  SshConfigHost,
  SshConnectionEvent,
  SshConnectionUsage,
  SshHealthState,
} from '@core/primitives/ssh/api';

export type SaveSshConnectionInput = Partial<Pick<SshConfig, 'id'>> &
  Omit<SshConfig, 'id'> & { password?: string; passphrase?: string };

const voidInput = z.void();
const connectionInput = z.object({ connectionId: z.string() });

export const sshContract = defineContract({
  getConnections: procedure({ input: voidInput, output: z.array(z.custom<SshConfig>()) }),
  getSshConfigHosts: procedure({
    input: voidInput,
    output: z.array(z.custom<SshConfigHost>()),
  }),
  getSshConfigHost: procedure({
    input: z.object({ alias: z.string() }),
    output: z.custom<SshConfigHost>(),
  }),
  getConnectionUsage: procedure({
    input: voidInput,
    output: z.custom<SshConnectionUsage>(),
  }),
  saveConnection: procedure({
    input: z.custom<SaveSshConnectionInput>(),
    output: z.custom<SshConfig>(),
  }),
  deleteConnection: procedure({
    input: z.object({ id: z.string() }),
    output: z.void(),
  }),
  testConnection: procedure({
    input: z.custom<SshConfig & { password?: string; passphrase?: string }>(),
    output: z.custom<ConnectionTestResult>(),
  }),
  disconnect: procedure({ input: connectionInput, output: z.void() }),
  connect: procedure({ input: connectionInput, output: z.custom<ConnectionState>() }),
  getState: procedure({
    input: connectionInput,
    output: z.enum(['connected', 'disconnected']),
  }),
  getConnectionState: procedure({
    input: voidInput,
    output: z.record(z.string(), z.custom<ConnectionState>()),
  }),
  getHealthStates: procedure({
    input: voidInput,
    output: z.record(z.string(), z.custom<SshHealthState>()),
  }),
  renameConnection: procedure({
    input: z.object({ id: z.string(), name: z.string() }),
    output: z.void(),
  }),
  events: eventStream({
    key: z.void(),
    event: z.custom<SshConnectionEvent>(),
  }),
});
