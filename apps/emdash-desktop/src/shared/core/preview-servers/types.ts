import type { Result } from '@emdash/shared';

export type PreviewServerSource =
  | {
      kind: 'terminal-output';
      terminalId: string;
    }
  | { kind: 'manual' };

export type PreviewServerStatus =
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'reconnecting' }
  | { kind: 'failed'; message: string };

export type PreviewServerProtocol = 'http:' | 'https:';
export type DirectPreviewServerHost = 'localhost' | '127.0.0.1';

export type PreviewServerBase = {
  id: string;
  projectId: string;
  workspaceId: string;
  source: PreviewServerSource;
  protocol: PreviewServerProtocol;
  urlPath: string;
  status: PreviewServerStatus;
};

export type DirectPreviewServer = PreviewServerBase & {
  kind: 'direct';
  host: DirectPreviewServerHost;
  port: number;
};

export type ForwardedPreviewServer = PreviewServerBase & {
  kind: 'forwarded';
  connectionId: string;
  remotePort: number;
  localPort?: number;
};

export type PreviewServer = DirectPreviewServer | ForwardedPreviewServer;

export function previewServerUrl(server: PreviewServer): string | null {
  if (server.kind === 'direct') {
    return `${server.protocol}//${server.host}:${server.port}${server.urlPath}`;
  }

  if (server.localPort === undefined) return null;
  return `${server.protocol}//127.0.0.1:${server.localPort}${server.urlPath}`;
}

export type ManualPreviewServerRequest = {
  projectId: string;
  workspaceId: string;
  connectionId: string;
  protocol: PreviewServerProtocol;
  remotePort: number;
  preferredLocalPort?: number;
};

export type ManualPreviewServerError =
  | { type: 'not-ssh-workspace'; message: string }
  | { type: 'cancelled'; message: string }
  | { type: 'open-failed'; message: string };

export type ManualPreviewServerResult = Result<PreviewServer, ManualPreviewServerError>;

export type PreviewServerEvent =
  | { type: 'upsert'; server: PreviewServer }
  | { type: 'remove'; id: string };
