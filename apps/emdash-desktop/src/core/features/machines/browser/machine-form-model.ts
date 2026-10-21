import type { SshConfig, SshConfigHost } from '@core/primitives/ssh/api';
import { createMachineFormSchema, type MachineFormValues } from './machine-form-schema';

export type MachineAuthType = 'password' | 'key' | 'agent';
export type MachineFormMode = 'manual' | 'config';
export type MachineAuthenticationDraft = Pick<
  MachineFormValues,
  'authType' | 'password' | 'privateKeyPath' | 'passphrase'
>;
export type MachineManualDraft = Omit<MachineFormValues, 'name' | 'sshConfigAlias'>;
export interface MachineEditorValues {
  name: string;
  manual: MachineManualDraft;
  config: MachineAuthenticationDraft;
}
export type MachineConnectionSource =
  | { mode: 'manual' }
  | { mode: 'config'; alias: string; resolved: SshConfigHost };

export function authenticationDraft(config?: SshConfig): MachineAuthenticationDraft {
  return {
    authType: config?.authType ?? 'password',
    password: '',
    privateKeyPath: config?.privateKeyPath ?? '',
    passphrase: '',
  };
}

export function machineEditorDefaults(initial?: SshConfig): MachineEditorValues {
  const manual = initial?.sshConfigAlias ? undefined : initial;
  return {
    name: initial?.name ?? '',
    manual: {
      ...authenticationDraft(manual),
      host: manual?.host ?? '',
      port: manual?.port ?? 22,
      username: manual?.username ?? '',
      forwardAgent: manual?.forwardAgent ?? false,
      proxyJump: manual?.proxyJump ?? '',
    },
    config: authenticationDraft(initial?.sshConfigAlias ? initial : undefined),
  };
}

/** Compose editable intent and read-only resolution without storing the resolution in the form. */
export function machineDraftValues(
  values: MachineEditorValues,
  source: MachineConnectionSource
): MachineFormValues {
  if (source.mode === 'manual') return { name: values.name, ...values.manual, sshConfigAlias: '' };
  return {
    name: values.name,
    ...values.config,
    sshConfigAlias: source.alias,
    host: source.resolved.hostname || source.alias,
    port: source.resolved.port ?? 22,
    username: source.resolved.user ?? '',
    proxyJump: '',
    forwardAgent: false,
  };
}

export function validateMachineDraft(
  values: MachineEditorValues,
  source: MachineConnectionSource,
  previous?: SshConfig
) {
  const result = createMachineFormSchema(previous).safeParse(machineDraftValues(values, source));
  if (result.success) return undefined;
  return {
    fields: Object.fromEntries(
      result.error.issues.map((issue) => [
        issue.path[0] === 'name' ? 'name' : `${source.mode}.${String(issue.path[0])}`,
        issue.message,
      ])
    ),
  };
}

export const DUPLICATE_CONNECTION_NAME_ERROR =
  'An SSH connection with this name already exists. Choose a different name.';

export function formatMachineError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const withoutIpcPrefix = message.replace(/^Error invoking remote method 'ssh\.[^']+':\s*/, '');
  return /UNIQUE constraint failed: ssh_connections\.name/.test(withoutIpcPrefix)
    ? DUPLICATE_CONNECTION_NAME_ERROR
    : withoutIpcPrefix;
}

export function machineConnectionConfig(
  value: MachineFormValues
): Omit<SshConfig, 'id'> & { password?: string; passphrase?: string } {
  const alias = value.sshConfigAlias || undefined;
  return {
    name: value.name || alias || value.host,
    host: value.host,
    port: value.port,
    username: value.username || alias || value.host,
    sshConfigAlias: alias,
    authType: value.authType,
    privateKeyPath: value.authType === 'key' ? value.privateKeyPath.trim() || undefined : undefined,
    useAgent: value.authType === 'agent',
    forwardAgent: alias ? undefined : value.forwardAgent,
    proxyJump: alias ? undefined : value.proxyJump.trim(),
    password: value.authType === 'password' ? value.password : undefined,
    passphrase: value.authType === 'key' ? value.passphrase : undefined,
  };
}

export function suggestedAuthTypeForSshConfigHost(host: SshConfigHost): MachineAuthType {
  if (host.identityAgent) return 'agent';
  if (host.identityFile) return 'key';
  return 'agent';
}
