/**
 * SSH Connection Configuration
 * Used for storing SSH connection settings
 */
export interface SshConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  sshConfigAlias?: string;
  authType: 'password' | 'key' | 'agent';
  privateKeyPath?: string;
  useAgent?: boolean;
  forwardAgent?: boolean;
  proxyJump?: string;
}

/**
 * Connection State
 * Represents the current state of an SSH connection
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type SshHealthState = { status: 'ok' } | { status: 'degraded' };

/**
 * SSH Connection with metadata
 * Extends SshConfig with runtime connection information
 */
export interface SshConnection extends SshConfig {
  id: string;
  state: ConnectionState;
  lastError?: string;
  connectedAt?: Date;
}

export type SshConnectionUsage = Record<string, Array<{ id: string; name: string }>>;

/**
 * Command execution result
 * Returned after executing a command on a remote host
 */
export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Test connection result
 * Returned when testing an SSH connection
 */
export interface ConnectionTestResult {
  success: boolean;
  error?: string;
  latency?: number;
  serverVersion?: string;
  debugLogs?: string[];
}

/**
 * Host key info
 * Contains information about a server's host key for verification
 */
export interface HostKeyInfo {
  host: string;
  port: number;
  fingerprint: string;
  algorithm: string;
  key: Buffer;
}

/**
 * SSH Config Host entry parsed from ~/.ssh/config
 */
export interface SshConfigHost {
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  identityAgent?: string;
  proxyJump?: string;
  proxyCommand?: string;
  forwardAgent?: boolean;
  forwardAgentValue?: string;
}
