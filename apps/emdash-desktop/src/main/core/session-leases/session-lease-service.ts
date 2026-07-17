import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getAcpRuntimeClient } from '@main/core/acp/controller';
import { dehydrateConversation } from '@main/core/conversations/dehydrateConversation';
import { hydrateConversation } from '@main/core/conversations/hydrateConversation';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { hydrateTerminal } from '@main/core/terminals/hydrateTerminal';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { conversations, terminals } from '@main/db/schema';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';

export type SessionLeaseKind = 'conversation' | 'acp' | 'terminal';
export type SessionLeaseOwnerType = 'desktop' | 'mobile';

export type AcquireSessionLeaseInput = {
  kind: SessionLeaseKind;
  projectId: string;
  taskId: string;
  resourceId: string;
  ownerType: SessionLeaseOwnerType;
  ownerId: string;
};

export type SessionLease = AcquireSessionLeaseInput & {
  id: string;
  actualKind: SessionLeaseKind;
  sessionId?: string;
};

type ResourceEntry = {
  leases: Map<string, SessionLease>;
};

export type SessionLeaseServiceOptions = {
  resolveResource?: (input: AcquireSessionLeaseInput) => Promise<ResolvedResource>;
  startResource?: (resource: ResolvedResource) => Promise<void>;
  stopResource?: (lease: SessionLease) => Promise<void>;
  createLeaseId?: () => string;
};

/**
 * Main-process ownership for UI-attached task runtimes.
 *
 * The service deliberately does not own persisted terminal lifetime: terminals retain their
 * existing run-until-deleted behavior. It does own conversation hydration, so a desktop tab
 * cannot dehydrate a PTY while a paired phone still has a lease.
 */
export class SessionLeaseService {
  private readonly entries = new Map<string, ResourceEntry>();
  private readonly leases = new Map<string, SessionLease>();
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly options: SessionLeaseServiceOptions = {}) {}

  async acquire(input: AcquireSessionLeaseInput): Promise<SessionLease> {
    const key = resourceKey(input.kind, input.resourceId);
    return await this.serialized(key, async () => {
      const resource = await (this.options.resolveResource ?? resolveResource)(input);
      const entry = this.entries.get(key) ?? { leases: new Map<string, SessionLease>() };
      const existing = [...entry.leases.values()].find(
        (lease) => lease.ownerType === input.ownerType && lease.ownerId === input.ownerId
      );
      if (existing) return existing;

      if (entry.leases.size === 0) {
        await (this.options.startResource ?? ((value) => this.startResource(value)))(resource);
      }

      const lease: SessionLease = {
        ...input,
        id: (this.options.createLeaseId ?? randomUUID)(),
        actualKind: resource.actualKind,
        ...(resource.sessionId ? { sessionId: resource.sessionId } : {}),
      };
      entry.leases.set(lease.id, lease);
      this.entries.set(key, entry);
      this.leases.set(lease.id, lease);
      return lease;
    });
  }

  async release(leaseId: string): Promise<void> {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    const key = resourceKey(lease.kind, lease.resourceId);
    await this.serialized(key, async () => {
      const current = this.leases.get(leaseId);
      if (!current) return;
      const entry = this.entries.get(key);
      if (!entry) {
        this.leases.delete(leaseId);
        return;
      }
      if (entry.leases.size > 1) {
        entry.leases.delete(leaseId);
        this.leases.delete(leaseId);
        return;
      }

      // Keep the final lease registered until detachment succeeds. This lets a
      // caller retry a transient teardown failure without losing ownership state.
      await (this.options.stopResource ?? ((value) => this.stopResource(value)))(current);
      entry.leases.delete(leaseId);
      this.leases.delete(leaseId);
      this.entries.delete(key);
    });
  }

  async releaseOwner(ownerType: SessionLeaseOwnerType, ownerId: string): Promise<void> {
    const ids = [...this.leases.values()]
      .filter((lease) => lease.ownerType === ownerType && lease.ownerId === ownerId)
      .map((lease) => lease.id);
    const results = await Promise.allSettled(ids.map((id) => this.release(id)));
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failure) throw failure.reason;
  }

  get(leaseId: string): SessionLease | undefined {
    return this.leases.get(leaseId);
  }

  canResize(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    if (lease.ownerType === 'desktop') return true;
    const entry = this.entries.get(resourceKey(lease.kind, lease.resourceId));
    return ![...(entry?.leases.values() ?? [])].some((item) => item.ownerType === 'desktop');
  }

  async dispose(): Promise<void> {
    const ids = [...this.leases.keys()];
    await Promise.all(ids.map((id) => this.release(id)));
  }

  private async startResource(resource: ResolvedResource): Promise<void> {
    if (resource.actualKind === 'terminal') {
      if (!ptySessionRegistry.get(resource.sessionId)) {
        await hydrateTerminal({
          projectId: resource.projectId,
          taskId: resource.taskId,
          terminalId: resource.resourceId,
        });
      }
      return;
    }

    if (resource.actualKind === 'conversation') {
      if (!ptySessionRegistry.get(resource.sessionId)) {
        await hydrateConversation(resource.projectId, resource.taskId, resource.resourceId);
      }
      return;
    }

    const persistData = taskSessionManager.getPersistData(resource.taskId);
    const workspaceId = persistData?.workspaceId;
    const workspace = workspaceId ? workspaceRegistry.get(workspaceId) : undefined;
    if (!workspaceId || !workspace) throw new Error('Task workspace is not ready');

    const conversation = resource.conversation;
    if (!conversation) throw new Error('ACP conversation not found');
    const client = await getAcpRuntimeClient();
    const result = await client.startSession({
      input: {
        conversationId: conversation.id,
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        providerId: conversation.providerId,
        workspaceId,
        cwd: workspace.path,
        sessionId: conversation.sessionId ?? null,
        model: conversation.model ?? null,
        ...(conversation.initialQueue?.length
          ? {
              initialQueue: conversation.initialQueue.map((item) => ({
                text: item.text,
                ...(item.hiddenContext ? { hiddenContext: item.hiddenContext } : {}),
              })),
            }
          : {}),
      },
    });
    if (!result.success) {
      const error = result.error as {
        message?: string;
        cause?: { message?: string };
        type: string;
      };
      const message = error.message ?? error.cause?.message ?? error.type;
      throw new Error(message);
    }
  }

  private async stopResource(lease: SessionLease): Promise<void> {
    if (lease.actualKind === 'terminal') return;
    if (lease.actualKind === 'conversation') {
      await dehydrateConversation(lease.projectId, lease.taskId, lease.resourceId);
      return;
    }

    const client = await getAcpRuntimeClient();
    const result = await client.stopSession({ conversationId: lease.resourceId });
    if (!result.success) throw new Error('Failed to stop ACP session');
  }

  private async serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let releaseQueue: (() => void) | undefined;
    const next = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const queued = previous.then(() => next);
    this.queues.set(key, queued);
    await previous;
    try {
      return await operation();
    } finally {
      releaseQueue?.();
      if (this.queues.get(key) === queued) this.queues.delete(key);
    }
  }
}

export type ResolvedResource = {
  actualKind: SessionLeaseKind;
  projectId: string;
  taskId: string;
  resourceId: string;
  sessionId: string;
  conversation?: ReturnType<typeof mapConversationRowToConversation>;
};

async function resolveResource(input: AcquireSessionLeaseInput): Promise<ResolvedResource> {
  const bootstrap = taskSessionManager.getBootstrapStatus(input.taskId);
  if (bootstrap.status !== 'ready') throw new Error('Task is not ready');

  if (input.kind === 'terminal') {
    const [row] = await db
      .select()
      .from(terminals)
      .where(
        and(
          eq(terminals.id, input.resourceId),
          eq(terminals.projectId, input.projectId),
          eq(terminals.taskId, input.taskId)
        )
      )
      .limit(1);
    if (!row) throw new Error('Terminal not found');
    return {
      actualKind: 'terminal',
      projectId: input.projectId,
      taskId: input.taskId,
      resourceId: input.resourceId,
      sessionId: makePtySessionId(input.projectId, input.taskId, input.resourceId),
    };
  }

  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.resourceId),
        eq(conversations.projectId, input.projectId),
        eq(conversations.taskId, input.taskId)
      )
    )
    .limit(1);
  if (!row) throw new Error('Conversation not found');
  const conversation = mapConversationRowToConversation(row);
  const actualKind = conversation.type === 'acp' ? 'acp' : 'conversation';
  if (input.kind !== actualKind) throw new Error('Conversation interface does not match');
  return {
    actualKind,
    projectId: input.projectId,
    taskId: input.taskId,
    resourceId: input.resourceId,
    sessionId: makePtySessionId(input.projectId, input.taskId, input.resourceId),
    conversation,
  };
}

function resourceKey(kind: SessionLeaseKind, resourceId: string): string {
  return `${kind === 'terminal' ? 'terminal' : 'conversation'}:${resourceId}`;
}

export const sessionLeaseService = new SessionLeaseService();
