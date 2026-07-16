export type MobileAccessSettings = {
  enabled: boolean;
  bindAddress: string | null;
  port: number;
};

export type MobileAccessRuntimeState = 'disabled' | 'starting' | 'running' | 'stopping' | 'error';

export type MobileAccessStatus = {
  state: MobileAccessRuntimeState;
  enabled: boolean;
  bindAddress: string | null;
  port: number;
  url: string | null;
  error: string | null;
  pairedClientCount: number;
  activeConnectionCount: number;
};

export type MobileAccessInterfaceKind = 'loopback' | 'private' | 'vpn';

export type MobileAccessBindableInterface = {
  name: string;
  address: string;
  kind: MobileAccessInterfaceKind;
};

export type MobileAccessPairingCode = {
  code: string;
  expiresAt: number;
};

export type MobileAccessClient = {
  id: string;
  name: string;
  pairedAt: number;
  lastSeenAt: number;
  connectionCount: number;
};

export type MobileAccessOperationErrorCode = 'not_running' | 'client_not_found' | 'restart_failed';

export type MobileAccessOperationResult<T = void> =
  | ({ success: true } & ([T] extends [void] ? object : { value: T }))
  | {
      success: false;
      error: {
        code: MobileAccessOperationErrorCode;
        message: string;
      };
    };
