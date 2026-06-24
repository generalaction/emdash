import type { Readable, Writable } from 'node:stream';
import z from 'zod';
import type {
  Client,
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  PromptRequest,
  PromptResponse,
  SetSessionConfigOptionRequest,
  SetSessionConfigOptionResponse,
  CloseSessionRequest,
  CloseSessionResponse,
  CancelNotification,
} from '@agentclientprotocol/sdk';
import { definePluginCapability } from '../../../lib/plugins/capability';

export type AcpSpawnContext = {
  /** Absolute path to the worktree / task directory. */
  cwd: string;
  /** Environment variables to pass to the spawned process. */
  env: Record<string, string>;
  /** Absolute path to the resolved host CLI binary (mirrors prompt's CommandContext.cli). */
  cli: string;
};

export type AcpSpawnResult = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

/** Stdio of a process the APP has already spawned and owns. */
export interface AcpProcessIo {
  stdin: Writable;
  stdout: Readable;
}

/**
 * Narrow agent surface the manager calls. ClientSideConnection satisfies this
 * structurally — only the methods emdash actually uses are required here.
 */
export interface AcpAgentApi {
  initialize(params: InitializeRequest): Promise<InitializeResponse>;
  newSession(params: NewSessionRequest): Promise<NewSessionResponse>;
  /** Optional — only available when the agent advertises the `loadSession` capability. */
  loadSession?(params: LoadSessionRequest): Promise<LoadSessionResponse>;
  prompt(params: PromptRequest): Promise<PromptResponse>;
  cancel(params: CancelNotification): Promise<void>;
  /** Optional — only available when the agent advertises the `setSessionConfigOption` capability. */
  setSessionConfigOption?(
    params: SetSessionConfigOptionRequest
  ): Promise<SetSessionConfigOptionResponse>;
  /** Optional — only available when the agent advertises the `session.close` capability. */
  closeSession?(params: CloseSessionRequest): Promise<CloseSessionResponse | void>;
}

/** The manager supplies this factory; the plugin forwards it into ClientSideConnection. */
export type AcpClientFactory = (agent: AcpAgentApi) => Client;

export interface IAcpBehavior {
  /**
   * Pure description of how to spawn the agent adapter process.
   * The APP spawns it and retains the ChildProcess handle for graceful cleanup.
   */
  buildSpawn(ctx: AcpSpawnContext): AcpSpawnResult;

  /**
   * Wrap an app-owned process's stdio into an ACP client connection.
   * The plugin owns adapter/SDK wiring; the app owns the process lifecycle.
   */
  connect(io: AcpProcessIo, toClient: AcpClientFactory): AcpAgentApi;
}

/**
 * Describes whether a provider supports the Agent Client Protocol (ACP) transport.
 * Defaults to `{ kind: 'none' }` so existing plugins need not declare it.
 */
export const acpCapability = definePluginCapability<IAcpBehavior>()(
  'acp',
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('supported') }),
  ]),
  { kind: 'none' }
);
