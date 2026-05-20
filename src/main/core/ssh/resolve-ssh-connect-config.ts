import { readFile } from 'node:fs/promises';
import ssh2, {
  type BaseAgent,
  type ConnectConfig,
  type IdentityCallback,
  type ParsedKey,
  type PublicKeyEntry,
  type SignCallback,
  type SigningRequestOptions,
} from 'ssh2';
import type { SshConnectionRow } from '@main/db/schema';
import type { SshConfig } from '@shared/ssh';
import { sshConfigFromRow } from './connection-metadata';
import {
  resolveAgentSocketFromResolved,
  resolveSshConfig as defaultResolveSshConfig,
  type ResolvedAgentSocket,
  type ResolvedSshConfig,
} from './resolve-ssh-config';
import { findSshConfigHostByHostName, parseSshConfigFile } from './sshConfigParser';
import {
  spawnProxyCommand as defaultSpawnProxyCommand,
  spawnProxyJump as defaultSpawnProxyJump,
  type ProxyTokens,
  type TransportResult,
} from './transports';

const { createAgent, utils } = ssh2;

export interface SshConnectResult {
  config: ConnectConfig;
  cleanup: () => void;
  debugLogs: string[];
}

export type PersistedConnectInput = { kind: 'persisted'; row: SshConnectionRow };
export type TransientConnectInput = {
  kind: 'transient';
  config: SshConfig & { password?: string; passphrase?: string };
};
export type SshConnectInput = PersistedConnectInput | TransientConnectInput;

export interface SshConnectDeps {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  getPassword: (connectionId: string) => Promise<string | null>;
  getPassphrase: (connectionId: string) => Promise<string | null>;
  resolveSshConfig: (alias: string) => Promise<ResolvedSshConfig>;
  findSshConfigByHostName: (hostname: string) => Promise<ResolvedSshConfig | undefined>;
  spawnProxyCommand: (command: string, tokens: ProxyTokens) => Omit<TransportResult, 'process'>;
  spawnProxyJump: (
    jumpSpec: string,
    destHost: string,
    destPort: number
  ) => Omit<TransportResult, 'process'>;
  createAgent: (socketPath: string) => BaseAgent;
  env: Record<string, string | undefined>;
}

function defaultDeps(): SshConnectDeps {
  return {
    readFile,
    getPassword: async () => {
      throw new Error('Password lookup dependency was not provided');
    },
    getPassphrase: async () => {
      throw new Error('Passphrase lookup dependency was not provided');
    },
    resolveSshConfig: (alias) => defaultResolveSshConfig(alias),
    findSshConfigByHostName: async (hostname) => {
      const hosts = await parseSshConfigFile();
      const match = findSshConfigHostByHostName(hosts, hostname);
      return match ? await defaultResolveSshConfig(match.host).catch(() => undefined) : undefined;
    },
    spawnProxyCommand: (command, tokens) => defaultSpawnProxyCommand(command, tokens),
    spawnProxyJump: (jumpSpec, destHost, destPort) =>
      defaultSpawnProxyJump(jumpSpec, destHost, destPort),
    createAgent,
    env: process.env,
  };
}

function expandTilde(filePath: string): string {
  if (filePath === '~') return process.env.HOME ?? filePath;
  if (filePath.startsWith('~/')) return `${process.env.HOME ?? ''}${filePath.slice(1)}`;
  return filePath;
}

type AgentPublicKey = ParsedKey | Buffer | string | PublicKeyEntry;

function comparablePublicKey(key: AgentPublicKey): ParsedKey | Buffer | string {
  if (typeof key === 'object' && 'pubKey' in key) {
    const pubKey = key.pubKey;
    if (typeof pubKey === 'object' && 'pubKey' in pubKey) {
      return pubKey.pubKey;
    }
    return pubKey;
  }
  return key;
}

class IdentityFilteredAgent implements BaseAgent {
  readonly kind = 'identity-filtered-agent';
  constructor(
    readonly socketPath: string,
    private readonly agent: BaseAgent,
    private readonly allowedKeys: ParsedKey[]
  ) {}

  getIdentities(callback: IdentityCallback): void {
    this.agent.getIdentities((error, keys) => {
      if (error) {
        callback(error);
        return;
      }
      callback(
        undefined,
        keys?.filter((key) =>
          this.allowedKeys.some((allowedKey) => allowedKey.equals(comparablePublicKey(key)))
        ) ?? []
      );
    });
  }

  sign(
    pubKey: string | Buffer | ParsedKey,
    data: Buffer,
    optionsOrCallback?: SigningRequestOptions | SignCallback,
    callback?: SignCallback
  ): void {
    if (typeof optionsOrCallback === 'function') {
      this.agent.sign(pubKey, data, optionsOrCallback);
      return;
    }
    this.agent.sign(pubKey, data, optionsOrCallback ?? {}, callback);
  }

  getStream(callback: Parameters<NonNullable<BaseAgent['getStream']>>[0]): void {
    this.agent.getStream?.(callback);
  }
}

async function readIdentityKey(path: string, deps: SshConnectDeps): Promise<ParsedKey | undefined> {
  const data = await deps.readFile(expandTilde(path), 'utf-8').catch(() => undefined);
  if (!data) return undefined;
  const parsed = utils.parseKey(data);
  return parsed instanceof Error ? undefined : parsed;
}

async function readIdentityKeys(paths: string[], deps: SshConnectDeps): Promise<ParsedKey[]> {
  const keys: ParsedKey[] = [];
  for (const path of paths) {
    const publicKey = await readIdentityKey(`${path}.pub`, deps);
    const key = publicKey ?? (await readIdentityKey(path, deps));
    if (key) keys.push(key);
  }
  return keys;
}

function baseConfigForInput(input: SshConnectInput): SshConfig {
  return input.kind === 'persisted' ? sshConfigFromRow(input.row) : input.config;
}

async function buildAuthConfig(
  input: SshConnectInput,
  base: SshConfig,
  resolved: ResolvedSshConfig | undefined,
  deps: SshConnectDeps
): Promise<Partial<ConnectConfig>> {
  switch (base.authType) {
    case 'password': {
      const password =
        input.kind === 'transient' ? input.config.password : await deps.getPassword(input.row.id);
      if (!password) throw new Error(`No password found for SSH connection '${base.name}'`);
      return { password };
    }

    case 'key': {
      const keyPath = base.privateKeyPath?.trim() || resolved?.identityFile[0];
      if (!keyPath)
        throw new Error(`Private key path is required for SSH connection '${base.name}'`);
      const privateKey = await deps.readFile(expandTilde(keyPath), 'utf-8');
      const passphrase =
        input.kind === 'transient'
          ? input.config.passphrase
          : await deps.getPassphrase(input.row.id);
      return { privateKey, ...(passphrase ? { passphrase } : {}) };
    }

    case 'agent': {
      const agentSocket = resolved
        ? resolveAgentSocketFromResolved(resolved, deps.env)
        : { kind: 'unset' as const };
      const agent =
        agentSocket.kind === 'socket'
          ? agentSocket.path
          : agentSocket.kind === 'disabled'
            ? undefined
            : deps.env.SSH_AUTH_SOCK;
      if (agentSocket.kind === 'disabled') {
        throw new Error(`SSH agent is disabled by SSH config for connection '${base.name}'`);
      }
      if (!agent) throw new Error(`SSH agent socket not found for connection '${base.name}'`);
      if (resolved?.identitiesOnly && resolved.identityFile.length > 0) {
        const identityKeys = await readIdentityKeys(resolved.identityFile, deps);
        if (identityKeys.length === 0) {
          throw new Error(
            `IdentitiesOnly is enabled, but no IdentityFile public keys could be loaded for SSH connection '${base.name}'`
          );
        }
        return {
          agent: new IdentityFilteredAgent(agent, deps.createAgent(agent), identityKeys),
        };
      }
      return { agent };
    }
  }
}

function expandForwardAgentValue(
  value: string,
  env: Record<string, string | undefined>
): string | undefined {
  if (value === 'SSH_AUTH_SOCK') return env.SSH_AUTH_SOCK;
  const variableOnly = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
  if (variableOnly) return env[variableOnly[1]];
  const bracedVariableOnly = value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (bracedVariableOnly) return env[bracedVariableOnly[1]];
  return value;
}

function agentForForwarding(resolved: ResolvedSshConfig | undefined, deps: SshConnectDeps): string {
  if (resolved?.forwardAgentValue) {
    const agent = expandForwardAgentValue(resolved.forwardAgentValue, deps.env);
    if (!agent) {
      throw new Error('Agent forwarding was requested, but the ForwardAgent socket is unavailable');
    }
    return agent;
  }

  const agentSocket = resolved
    ? resolveAgentSocketFromResolved(resolved, deps.env)
    : ({ kind: 'unset' } satisfies ResolvedAgentSocket);
  const agent = agentSocket.kind === 'socket' ? agentSocket.path : deps.env.SSH_AUTH_SOCK;
  if (!agent) {
    throw new Error('Agent forwarding was requested, but no SSH agent socket is available');
  }
  return agent;
}

function assertAgentSocketCompatible(config: ConnectConfig, forwardingAgent: string): void {
  if (typeof config.agent === 'string' && config.agent !== forwardingAgent) {
    throw new Error(
      'Agent authentication and ForwardAgent resolved to different SSH agent sockets, which ssh2 cannot represent safely'
    );
  }
  if (
    config.agent instanceof IdentityFilteredAgent &&
    config.agent.socketPath !== forwardingAgent
  ) {
    throw new Error(
      'Agent authentication and ForwardAgent resolved to different SSH agent sockets, which ssh2 cannot represent safely'
    );
  }
}

async function resolveManualAgentSshConfig(
  host: string,
  deps: SshConnectDeps
): Promise<ResolvedSshConfig | undefined> {
  const direct = await deps.resolveSshConfig(host).catch(() => undefined);
  if (direct) {
    const agentSocket = resolveAgentSocketFromResolved(direct, deps.env);
    if (agentSocket.kind !== 'unset') return direct;
  }

  return (await deps.findSshConfigByHostName(host).catch(() => undefined)) ?? direct;
}

export async function resolveSshConnectConfig(
  input: SshConnectInput,
  depsOverride: Partial<SshConnectDeps> = {}
): Promise<SshConnectResult> {
  const deps = { ...defaultDeps(), ...depsOverride };
  const base = baseConfigForInput(input);
  const alias = base.sshConfigAlias;
  const resolved = alias ? await deps.resolveSshConfig(alias) : undefined;
  const shouldResolveHostForAgent = !alias && base.authType === 'agent';
  const agentResolved = shouldResolveHostForAgent
    ? await resolveManualAgentSshConfig(base.host, deps)
    : resolved;

  const host = resolved?.hostname || base.host;
  const port = resolved?.port ?? base.port;
  const username = resolved?.user || base.username;
  const authConfig = await buildAuthConfig(input, base, agentResolved, deps);

  const config: ConnectConfig = {
    host,
    port,
    username,
    readyTimeout: resolved?.connectTimeout ? resolved.connectTimeout * 1000 : 20_000,
    keepaliveInterval: resolved?.serverAliveInterval ? resolved.serverAliveInterval * 1000 : 60_000,
    keepaliveCountMax: resolved?.serverAliveCountMax ?? 3,
    ...authConfig,
  };

  const forwardAgent = resolved?.forwardAgent ?? base.forwardAgent === true;
  if (forwardAgent) {
    const forwardingAgent = agentForForwarding(agentResolved, deps);
    assertAgentSocketCompatible(config, forwardingAgent);
    config.agentForward = true;
    if (typeof config.agent !== 'object') {
      config.agent = forwardingAgent;
    }
  }

  let debugLogs: string[] = [];
  let cleanup = () => {};
  const tokens: ProxyTokens = { host, port, username, originalHost: alias ?? base.host };
  const proxyCommand = alias ? resolved?.proxyCommand : undefined;
  const proxyJump = resolved?.proxyJump ?? (!alias ? base.proxyJump : undefined);

  let transport: Omit<TransportResult, 'process'> | undefined;
  if (proxyCommand) {
    transport = deps.spawnProxyCommand(proxyCommand, tokens);
  } else if (proxyJump) {
    transport = deps.spawnProxyJump(proxyJump, host, port);
  }

  if (transport) {
    config.sock = transport.sock;
    cleanup = transport.cleanup;
    debugLogs = transport.debugLogs;
  }

  return { config, cleanup, debugLogs };
}

export function createSshConnectConfigResolver(deps: SshConnectDeps) {
  return async (input: SshConnectInput): Promise<SshConnectResult> =>
    await resolveSshConnectConfig(input, deps);
}
