export type AcpImplementationInfo = {
  name?: string;
  title?: string;
  version?: string;
};

export type AcpAgentCapabilities = {
  loadSession?: boolean;
  promptCapabilities?: {
    image?: boolean;
    audio?: boolean;
    embeddedContext?: boolean;
  };
  sessionCapabilities?: {
    resume?: Record<string, unknown>;
    close?: Record<string, unknown>;
    additionalDirectories?: Record<string, unknown>;
  };
  mcpCapabilities?: {
    http?: boolean;
    sse?: boolean;
  };
};

export type AcpSessionUpdate = {
  sessionUpdate: string;
  [key: string]: unknown;
};

export type AcpPermissionOption = {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string;
};

export type AcpPermissionRequest = {
  requestId: string;
  toolCallId?: string;
  title?: string;
  kind?: string;
  options: AcpPermissionOption[];
  details: string;
};

export type AcpSessionStatus =
  | 'starting'
  | 'ready'
  | 'running'
  | 'idle'
  | 'cancelled'
  | 'error'
  | 'exited';

export type AcpSessionEvent = {
  projectId: string;
  taskId: string;
  conversationId: string;
} & (
  | { type: 'status'; status: AcpSessionStatus; message?: string }
  | {
      type: 'session';
      acpSessionId: string;
      agentInfo?: AcpImplementationInfo;
      agentCapabilities?: AcpAgentCapabilities;
    }
  | { type: 'update'; update: AcpSessionUpdate }
  | { type: 'permission_request'; request: AcpPermissionRequest }
  | { type: 'permission_resolved'; requestId: string; outcome: 'selected' | 'cancelled' }
  | { type: 'diagnostic'; message: string }
);
