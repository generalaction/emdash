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
import type { FsPort, TerminalPort } from '../client-ports';
import type { NormalizedEvent } from '../reducer/normalized-event';
import type { ConnectionPoolEntry } from './pool';

export interface InboundRouter {
  onSessionUpdate(connection: ConnectionPoolEntry, params: SessionNotification, event: NormalizedEvent): void;
  onPermissionRequest(
    connection: ConnectionPoolEntry,
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse>;
  onCreateTerminal(
    connection: ConnectionPoolEntry,
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse>;
}

export interface ClientHandlerPorts {
  fs: FsPort;
  terminals: TerminalPort;
}

export function buildClientHandler(
  getConnection: () => ConnectionPoolEntry | null,
  router: InboundRouter,
  ports: ClientHandlerPorts
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
