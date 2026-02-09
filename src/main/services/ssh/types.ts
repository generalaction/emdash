import { Client, SFTPWrapper } from 'ssh2';
import { SshConfig } from '../../../shared/ssh/types';

export interface Connection {
  id: string;
  config: SshConfig;
  client: Client;
  sftp?: SFTPWrapper;
  connectedAt: Date;
  lastActivity: Date;
}

export interface ConnectionPool {
  [connectionId: string]: Connection;
}

export interface HostKeyEntry {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  verifiedAt: Date;
}

export interface ConnectionMetrics {
  connectionId: string;
  bytesSent: number;
  bytesReceived: number;
  latencyMs: number;
  lastPingAt?: Date;
}
