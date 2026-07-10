import type {
  Client,
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { NormalizedEvent } from '@emdash/core/acp';
import type { AcpConnectionEntry } from '../connection/source';
import type { FsPort } from './fs-port';
import type { TerminalPort } from './terminal-port';

export interface InboundRouter {
  onSessionUpdate(
    connection: AcpConnectionEntry,
    params: SessionNotification,
    event: NormalizedEvent
  ): void;
  onPermissionRequest(
    connection: AcpConnectionEntry,
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse>;
  onCreateTerminal(
    connection: AcpConnectionEntry,
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse>;
}

export interface AgentPorts {
  fs: FsPort;
  terminals: TerminalPort;
}

export function buildAgentClient(
  getConnection: () => AcpConnectionEntry | null,
  router: InboundRouter,
  ports: AgentPorts
): Client {
  return {
    sessionUpdate: async (params: SessionNotification): Promise<void> => {
      const connection = getConnection();
      if (!connection) return;
      router.onSessionUpdate(connection, params, connection.normalize(params.update));
    },

    requestPermission: (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
      const connection = getConnection();
      if (!connection) return Promise.resolve({ outcome: { outcome: 'cancelled' } });
      return router.onPermissionRequest(connection, params);
    },

    readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
      return ports.fs.readTextFile(params);
    },

    writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
      return ports.fs.writeTextFile(params);
    },

    createTerminal: async (params: CreateTerminalRequest): Promise<CreateTerminalResponse> => {
      const connection = getConnection();
      if (!connection) throw new Error('ACP connection not found for createTerminal');
      return router.onCreateTerminal(connection, params);
    },

    terminalOutput: async (params: TerminalOutputRequest): Promise<TerminalOutputResponse> => {
      return ports.terminals.terminalOutput(params);
    },

    waitForTerminalExit: async (
      params: WaitForTerminalExitRequest
    ): Promise<WaitForTerminalExitResponse> => {
      return ports.terminals.waitForTerminalExit(params);
    },

    killTerminal: async (params: KillTerminalRequest): Promise<KillTerminalResponse> => {
      return ports.terminals.killTerminal(params);
    },

    releaseTerminal: async (params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> => {
      return ports.terminals.releaseTerminal(params);
    },
  };
}
