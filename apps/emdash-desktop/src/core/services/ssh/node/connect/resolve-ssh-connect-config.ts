import { readFile } from 'node:fs/promises';
import type { Secret } from '@emdash/shared';
import { sshConfigFromRow, type SshConfig } from '@core/primitives/ssh/api';
import type { SshConnectionRow } from '@core/services/app-db/node/schema';
import { resolveSshConfig, type ResolvedSshConfig } from '../config/resolve-ssh-config';
import {
  assertPasswordDestination,
  effectiveSshConfig,
  expandSshKeyPath,
  readSshPrivateKey,
} from '../credentials/credential-identity';
import {
  resolveCredentialDraft,
  type CredentialLookup,
} from '../credentials/resolve-credential-draft';

/** Immutable launch profile. Secrets are disclosed only to a matching askpass request. */
export interface OpenSshConfig {
  executable?: string;
  destination: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  readyTimeout: number;
  username: string;
  hostname: string;
  password?: Secret<string>;
  passphrase?: Secret<string>;
  keyPath?: string;
  keyFingerprint?: string;
}

export interface SshConnectResult {
  config: OpenSshConfig;
  debugLogs: string[];
}
export type SshConnectInput =
  | { kind: 'persisted'; row: SshConnectionRow }
  | {
      kind: 'transient';
      config: SshConfig & { password?: string; passphrase?: string };
      previous?: SshConfig;
    };

export interface SshConnectDeps extends CredentialLookup {
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  resolveSshConfig(alias: string): Promise<ResolvedSshConfig>;
  findSshConfigByHostName?(hostname: string): Promise<ResolvedSshConfig | undefined>;
  env: NodeJS.ProcessEnv;
}

const defaultDeps: SshConnectDeps = {
  readFile,
  resolveSshConfig,
  env: process.env,
  getPassword: async () => {
    throw new Error('Password lookup dependency was not provided');
  },
  getPassphrase: async () => {
    throw new Error('Passphrase lookup dependency was not provided');
  },
};

export async function resolveSshConnectConfig(
  input: SshConnectInput,
  overrides: Partial<SshConnectDeps> = {}
): Promise<SshConnectResult> {
  const deps = { ...defaultDeps, ...overrides };
  const base = input.kind === 'persisted' ? sshConfigFromRow(input.row) : input.config;
  const destination = base.sshConfigAlias || base.host;
  validateDestination(destination);
  const resolved = base.sshConfigAlias ? await deps.resolveSshConfig(destination) : undefined;
  const effective = effectiveSshConfig(base, resolved);
  validateDestination(effective.host);
  if (!effective.username || /[\r\n\0]/.test(effective.username))
    throw new Error('Invalid SSH username');
  if (!Number.isInteger(effective.port) || effective.port < 1 || effective.port > 65535)
    throw new Error('Invalid SSH port');
  assertPasswordDestination(base, effective);

  const readyTimeout =
    resolved?.connectTimeout === undefined
      ? input.kind === 'transient'
        ? 10_000
        : 20_000
      : resolved.connectTimeout * 1000;
  const args = [
    '-T',
    '-o',
    'PermitLocalCommand=no',
    '-o',
    'RemoteCommand=none',
    '-o',
    'ControlMaster=no',
    '-o',
    'ControlPath=none',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'NumberOfPasswordPrompts=1',
    '-o',
    `HostName=${effective.host}`,
    '-l',
    effective.username,
    '-p',
    String(effective.port),
    '-o',
    `ConnectTimeout=${readyTimeout / 1000}`,
    '-o',
    `ServerAliveInterval=${resolved?.serverAliveInterval ?? 60}`,
    '-o',
    `ServerAliveCountMax=${resolved?.serverAliveCountMax ?? 3}`,
  ];
  // Alias directives stay in OpenSSH: certificates, IdentityAgent, ProxyCommand, Match, etc.
  if (!base.sshConfigAlias) {
    if (base.proxyJump) {
      for (const jump of base.proxyJump.split(',')) validateDestination(jump);
      args.push('-J', base.proxyJump);
    }
    args.push(base.forwardAgent ? '-A' : '-a');
  }
  const config: OpenSshConfig = {
    destination,
    args,
    readyTimeout,
    env: { ...deps.env },
    hostname: effective.host,
    username: effective.username,
  };
  if (base.authType === 'password') {
    const credentials = await resolveCredentialDraft(
      effective,
      input.kind === 'transient' ? input.previous : base,
      deps
    );
    config.password = credentials.password ?? undefined;
    args.push('-o', 'PreferredAuthentications=password', '-o', 'PubkeyAuthentication=no');
  } else {
    args.push('-o', 'PreferredAuthentications=publickey');
    if (base.authType === 'agent' && !base.sshConfigAlias && deps.findSshConfigByHostName) {
      // Older imports saved HostName without its alias. Preserve their agent selection only;
      // the saved destination/account and current native policy remain authoritative.
      const direct = await deps.resolveSshConfig(destination);
      if (!direct.identityAgent && !direct.identityAgentDisabled) {
        const legacy = await deps.findSshConfigByHostName(base.host);
        if (legacy?.identityAgent || legacy?.identityAgentDisabled) {
          args.push('-o', `IdentityAgent=${legacy.identityAgent ?? 'none'}`);
          if (legacy.identitiesOnly) {
            args.push('-o', 'IdentitiesOnly=yes');
            for (const file of legacy.identityFile) args.push('-i', expandSshKeyPath(file));
          }
        }
      }
    }
    if (base.authType === 'key') {
      const { fingerprint } = await readSshPrivateKey(base, resolved, deps.readFile);
      const credentials = await resolveCredentialDraft(
        effective,
        input.kind === 'transient' ? input.previous : base,
        deps,
        fingerprint
      );
      config.keyPath = expandSshKeyPath(base.privateKeyPath?.trim() || resolved!.identityFile[0]);
      if (/[\r\n\0]/.test(config.keyPath)) throw new Error('Invalid SSH key path');
      config.keyFingerprint = fingerprint;
      config.passphrase = credentials.passphrase ?? undefined;
      args.push('-i', config.keyPath, '-o', 'IdentitiesOnly=yes');
    }
  }
  return { config, debugLogs: [] };
}

function validateDestination(value: string): void {
  if (!value || value.startsWith('-') || !/^[A-Za-z0-9._@%+:/[\]-]+$/.test(value)) {
    throw new Error(`Invalid SSH destination: ${value}`);
  }
}

export function createSshConnectConfigResolver(deps: SshConnectDeps) {
  return (input: SshConnectInput) => resolveSshConnectConfig(input, deps);
}
