import type { AgentAuthStatus } from '@emdash/core/agents/plugins';

export type AcpRuntimeControlRequest =
  | {
      type: 'resolve-spawn-context';
      requestId: string;
      providerId: string;
    }
  | {
      type: 'check-auth';
      requestId: string;
      providerId: string;
    }
  | {
      type: 'mark-auth-required';
      providerId: string;
      message?: string;
    }
  | {
      type: 'persist-session-id';
      conversationId: string;
      sessionId: string;
    }
  | {
      type: 'log';
      level: 'debug' | 'info' | 'warn' | 'error';
      message: string;
      data?: unknown;
    };

export type AcpRuntimeControlResponse =
  | {
      type: 'check-auth-result';
      requestId: string;
      ok: true;
      value: AgentAuthStatus;
    }
  | {
      type: 'check-auth-result';
      requestId: string;
      ok: false;
      error: string;
    }
  | {
      type: 'resolve-spawn-context-result';
      requestId: string;
      ok: true;
      value: { cli: string; agentEnv: Record<string, string> };
    }
  | {
      type: 'resolve-spawn-context-result';
      requestId: string;
      ok: false;
      error: string;
    };

export type AcpRuntimeHostMessage =
  | {
      type: 'shutdown';
    }
  | AcpRuntimeControlResponse;

export type AcpRuntimeChildMessage = AcpRuntimeControlRequest;

export interface UtilityParentPortMessageEvent {
  data: unknown;
}

export interface UtilityParentPort {
  postMessage(message: unknown, transfer?: unknown[]): void;
  on(event: 'message', cb: (event: UtilityParentPortMessageEvent) => void): void;
}
