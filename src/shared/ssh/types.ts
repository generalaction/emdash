/**
 * SSH Connection Configuration
 * Used for storing SSH connection settings
 */
export interface SshConfig {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key' | 'agent';
  privateKeyPath?: string;
  useAgent?: boolean;
}

/**
 * Connection State
 * Represents the current state of an SSH connection
 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

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
 * File entry for SFTP operations
 * Represents a file or directory on a remote host
 */
export interface FileEntry {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifiedAt: Date;
  permissions?: string;
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
 * IPC channel names for SSH operations
 * Using 'as const' ensures type safety and prevents typos
 */
export const SSH_IPC_CHANNELS = {
  TEST_CONNECTION: 'ssh:testConnection',
  SAVE_CONNECTION: 'ssh:saveConnection',
  GET_CONNECTIONS: 'ssh:getConnections',
  DELETE_CONNECTION: 'ssh:deleteConnection',
  CONNECT: 'ssh:connect',
  DISCONNECT: 'ssh:disconnect',
  EXECUTE_COMMAND: 'ssh:executeCommand',
  LIST_FILES: 'ssh:listFiles',
  READ_FILE: 'ssh:readFile',
  WRITE_FILE: 'ssh:writeFile',
  GET_STATE: 'ssh:getState',
  ON_STATE_CHANGE: 'ssh:onStateChange',
  GET_SSH_CONFIG: 'ssh:getSshConfig',
  GET_SSH_CONFIG_HOST: 'ssh:getSshConfigHost',
  CHECK_IS_GIT_REPO: 'ssh:checkIsGitRepo',
  INIT_REPO: 'ssh:initRepo',
  CLONE_REPO: 'ssh:cloneRepo',
} as const;

/**
 * Type for SSH IPC channel names
 * Can be used for type-safe IPC handlers
 */
export type SshIpcChannel = (typeof SSH_IPC_CHANNELS)[keyof typeof SSH_IPC_CHANNELS];

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
}
