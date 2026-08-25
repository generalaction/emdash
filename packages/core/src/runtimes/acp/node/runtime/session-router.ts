import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import type { Logger } from '@emdash/shared/logger';
import type { NormalizedEvent } from '#runtimes/acp/api';
import type { InboundRouter } from '#runtimes/acp/node/agent-ports/agent-client';
import type { AcpConnectionContext } from '#runtimes/acp/node/connection/source';

export interface SessionRouteTarget {
  onSessionUpdate(
    conversationId: string,
    connection: AcpConnectionContext,
    params: SessionNotification,
    event: NormalizedEvent
  ): void;
  onPermissionRequest(
    conversationId: string,
    connection: AcpConnectionContext,
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse>;
  onCreateTerminal(
    conversationId: string,
    connection: AcpConnectionContext,
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse>;
}

export class SessionRouter implements InboundRouter {
  private readonly routes = new Map<string, Map<string, string>>();
  private readonly loadingConversations = new Map<string, Set<string>>();

  constructor(
    private readonly target: SessionRouteTarget,
    private readonly logger: Logger
  ) {}

  onSessionUpdate(
    connection: AcpConnectionContext,
    params: SessionNotification,
    event: NormalizedEvent
  ): void {
    const conversationId = this.resolveConversationForSession(
      connectionRouteOwnerId(connection),
      params.sessionId
    );
    if (!conversationId) {
      this.logger.warn('SessionManager: sessionUpdate for unknown sessionId', {
        sessionId: params.sessionId,
      });
      return;
    }
    this.target.onSessionUpdate(conversationId, connection, params, event);
  }

  onPermissionRequest(
    connection: AcpConnectionContext,
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const conversationId = this.resolveConversationForSession(
      connectionRouteOwnerId(connection),
      params.sessionId
    );
    if (!conversationId) return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    return this.target.onPermissionRequest(conversationId, connection, params);
  }

  onCreateTerminal(
    connection: AcpConnectionContext,
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    const conversationId = this.resolveConversationForSession(
      connectionRouteOwnerId(connection),
      params.sessionId
    );
    if (!conversationId) {
      throw new Error(`SessionManager: no conversation for ACP sessionId ${params.sessionId}`);
    }
    return this.target.onCreateTerminal(conversationId, connection, params);
  }

  register(processOwner: string, acpSessionId: string, conversationId: string): void {
    let bySession = this.routes.get(processOwner);
    if (!bySession) {
      bySession = new Map();
      this.routes.set(processOwner, bySession);
    }
    bySession.set(acpSessionId, conversationId);
  }

  unregister(processOwner: string, conversationId: string): void {
    const bySession = this.routes.get(processOwner);
    if (!bySession) return;
    for (const [sessionId, mappedConversationId] of bySession) {
      if (mappedConversationId === conversationId) bySession.delete(sessionId);
    }
    if (bySession.size === 0) this.routes.delete(processOwner);
  }

  addLoading(processOwner: string, conversationId: string): void {
    let loading = this.loadingConversations.get(processOwner);
    if (!loading) {
      loading = new Set();
      this.loadingConversations.set(processOwner, loading);
    }
    loading.add(conversationId);
  }

  removeLoading(processOwner: string, conversationId: string): void {
    const loading = this.loadingConversations.get(processOwner);
    if (!loading) return;
    loading.delete(conversationId);
    if (loading.size === 0) this.loadingConversations.delete(processOwner);
  }

  hasRoutesFor(conversationId: string): boolean {
    for (const bySession of this.routes.values()) {
      if ([...bySession.values()].includes(conversationId)) return true;
    }
    return false;
  }

  isLoadingConversation(conversationId: string): boolean {
    for (const loading of this.loadingConversations.values()) {
      if (loading.has(conversationId)) return true;
    }
    return false;
  }

  private resolveConversationForSession(processOwner: string, acpSessionId: string): string | null {
    const route = this.routes.get(processOwner)?.get(acpSessionId);
    if (route) return route;
    const loading = this.loadingConversations.get(processOwner);
    const pending = loading?.values().next().value;
    if (!pending) return null;
    this.register(processOwner, acpSessionId, pending);
    return pending;
  }
}

export function connectionRouteOwnerId(connection: AcpConnectionContext): string {
  return `${connection.key}:${connection.generation}`;
}
