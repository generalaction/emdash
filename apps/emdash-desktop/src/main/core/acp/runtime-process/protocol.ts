import type { AcpMessagePort } from '@emdash/core/acp';

export type AcpRuntimeControlRequest =
  | {
      type: 'resolve-spawn-context';
      requestId: string;
      providerId: string;
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
      type: 'client-port';
    }
  | {
      type: 'shutdown';
    }
  | AcpRuntimeControlResponse;

export type AcpRuntimeChildMessage = AcpRuntimeControlRequest;

export interface UtilityParentPort {
  postMessage(message: unknown, transfer?: unknown[]): void;
  on(event: 'message', cb: (message: unknown, handle?: unknown) => void): void;
}

export type RuntimeMessagePort = AcpMessagePort;
