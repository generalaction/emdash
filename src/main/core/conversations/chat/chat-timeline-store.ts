import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { db as defaultDb, type AppDb } from '@main/db/client';
import { conversationTimelineItems, conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import {
  type AppendConversationTimelineItemInput,
  type ConversationMessageTimelineItem,
  type ConversationPermissionOption,
  type ConversationPermissionRequestTimelineItem,
  type ConversationPermissionResponse,
  type ConversationTimelineItem,
  type ConversationTimelineItemKind,
  type ConversationTimelineItemPayload,
  type ConversationTimelineListOptions,
  type SendConversationMessageInput,
} from '@shared/conversation-timeline';
import { shouldUseChatRuntime, type Conversation } from '@shared/conversations';
import { conversationTimelineEventChannel } from '@shared/events/conversationEvents';
import { mapConversationRowToConversation } from '../utils';

const DEFAULT_TIMELINE_LIMIT = 100;
const MAX_TIMELINE_LIMIT = 500;
const PENDING_DELIVERY_STATUS = '__emdash_pending_delivery__';
const DELIVERY_STARTED_STATUS = '__emdash_delivery_started__';
const CANCELLED_DELIVERY_STATUS = '__emdash_cancelled_delivery__';
const DELIVERED_PENDING_EMIT_STATUS = '__emdash_delivered_pending_emit__';

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_TIMELINE_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_TIMELINE_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), MAX_TIMELINE_LIMIT));
}

function parsePayload(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid conversation timeline payload');
  }
  return parsed as Record<string, unknown>;
}

function recoverPendingDeliveryPayload(
  raw: string
): { action: 'commit'; payload: string; warning?: string } | { action: 'delete' } | undefined {
  try {
    const payload = parsePayload(raw);
    if (
      payload.deliveryStatus === PENDING_DELIVERY_STATUS ||
      payload.deliveryStatus === CANCELLED_DELIVERY_STATUS
    ) {
      return { action: 'delete' };
    }
    if (
      payload.deliveryStatus !== DELIVERY_STARTED_STATUS &&
      payload.deliveryStatus !== DELIVERED_PENDING_EMIT_STATUS
    ) {
      return undefined;
    }
    const { deliveryStatus: _deliveryStatus, ...deliveredPayload } = payload;
    validatePayload('user_message', deliveredPayload);
    return {
      action: 'commit',
      payload: JSON.stringify(deliveredPayload),
      warning:
        payload.deliveryStatus === DELIVERY_STARTED_STATUS
          ? 'Emdash restarted before it could confirm whether this message reached the agent backend.'
          : undefined,
    };
  } catch {
    return undefined;
  }
}

function deliveredTimelinePayloadPredicate() {
  const deliveryStatus = sql`case when json_valid(${conversationTimelineItems.payload}) then coalesce(json_extract(${conversationTimelineItems.payload}, '$.deliveryStatus'), '') else '' end`;
  return sql`${deliveryStatus} != ${PENDING_DELIVERY_STATUS} and ${deliveryStatus} != ${DELIVERY_STARTED_STATUS} and ${deliveryStatus} != ${CANCELLED_DELIVERY_STATUS} and ${deliveryStatus} != ${DELIVERED_PENDING_EMIT_STATUS}`;
}

function stableTimelineItemId(conversationId: string, itemId: string): string {
  return `${conversationId}:${itemId}`;
}

function restoreStableTimelineItemId(
  conversationId: string,
  item: ConversationTimelineItem
): ConversationTimelineItem {
  const prefix = `${conversationId}:`;
  if (!item.id.startsWith(prefix)) return item;
  return { ...item, id: item.id.slice(prefix.length) };
}

function notCancelledDeliveryPredicate() {
  return sql`case when json_valid(${conversationTimelineItems.payload}) then coalesce(json_extract(${conversationTimelineItems.payload}, '$.deliveryStatus'), '') else '' end != ${CANCELLED_DELIVERY_STATUS}`;
}

function cancellableDeliveryPredicate() {
  const deliveryStatus = sql`case when json_valid(${conversationTimelineItems.payload}) then coalesce(json_extract(${conversationTimelineItems.payload}, '$.deliveryStatus'), '') else '' end`;
  return sql`(${deliveryStatus} = ${PENDING_DELIVERY_STATUS} or ${deliveryStatus} = ${DELIVERY_STARTED_STATUS})`;
}

function deliveredDeliveryPredicate() {
  const deliveryStatus = sql`case when json_valid(${conversationTimelineItems.payload}) then coalesce(json_extract(${conversationTimelineItems.payload}, '$.deliveryStatus'), '') else '' end`;
  return sql`(${deliveryStatus} = ${PENDING_DELIVERY_STATUS} or ${deliveryStatus} = ${DELIVERY_STARTED_STATUS} or ${deliveryStatus} = ${CANCELLED_DELIVERY_STATUS})`;
}

function deletableSilentItemPredicate() {
  const deliveryStatus = sql`case when json_valid(${conversationTimelineItems.payload}) then coalesce(json_extract(${conversationTimelineItems.payload}, '$.deliveryStatus'), '') else '' end`;
  return sql`(${conversationTimelineItems.kind} != 'user_message' or ${deliveryStatus} = ${PENDING_DELIVERY_STATUS} or ${deliveryStatus} = ${DELIVERY_STARTED_STATUS} or ${deliveryStatus} = ${CANCELLED_DELIVERY_STATUS})`;
}

function rowToTimelineItem(
  row: typeof conversationTimelineItems.$inferSelect
): ConversationTimelineItem {
  const payload = parsePayload(row.payload);
  const base = {
    id: row.id,
    conversationId: row.conversationId,
    sequence: row.sequence,
    createdAt: row.createdAt,
  };

  switch (row.kind) {
    case 'user_message':
    case 'assistant_message':
    case 'reasoning': {
      const validated = validatePayload(row.kind, payload) as ConversationTimelineItemPayload<
        'user_message' | 'assistant_message' | 'reasoning'
      >;
      return { ...base, kind: row.kind, text: validated.text };
    }
    case 'tool_call': {
      const validated = validatePayload(
        row.kind,
        payload
      ) as ConversationTimelineItemPayload<'tool_call'>;
      return {
        ...base,
        kind: 'tool_call',
        toolName: validated.toolName,
        status: validated.status,
        input: validated.input,
        output: validated.output,
        error: validated.error,
      };
    }
    case 'permission_request': {
      const validated = validatePayload(
        row.kind,
        payload
      ) as ConversationTimelineItemPayload<'permission_request'>;
      return {
        ...base,
        kind: 'permission_request',
        requestId: validated.requestId,
        title: validated.title,
        body: validated.body,
        ...(validated.input === undefined ? {} : { input: validated.input }),
        options: validated.options,
        status: validated.status,
      };
    }
    case 'error': {
      const validated = validatePayload(
        row.kind,
        payload
      ) as ConversationTimelineItemPayload<'error'>;
      return { ...base, kind: 'error', message: validated.message };
    }
    default:
      throw new Error('Invalid conversation timeline kind');
  }
}

function validatePayload(
  kind: ConversationTimelineItemKind,
  payload: Record<string, unknown>
): ConversationTimelineItemPayload {
  switch (kind) {
    case 'user_message':
    case 'assistant_message':
    case 'reasoning': {
      if (typeof payload.text !== 'string') {
        throw new Error('Invalid conversation timeline payload');
      }
      return { text: payload.text };
    }
    case 'tool_call': {
      if (
        typeof payload.toolName !== 'string' ||
        !isToolCallStatus(payload.status) ||
        (payload.output !== undefined && typeof payload.output !== 'string') ||
        (payload.error !== undefined && typeof payload.error !== 'string')
      ) {
        throw new Error('Invalid conversation timeline payload');
      }
      return {
        toolName: payload.toolName,
        status: payload.status,
        input: payload.input,
        output: payload.output,
        error: payload.error,
      };
    }
    case 'permission_request': {
      if (
        typeof payload.requestId !== 'string' ||
        typeof payload.title !== 'string' ||
        (payload.body !== undefined && typeof payload.body !== 'string') ||
        !isPermissionOptions(payload.options) ||
        !isPermissionStatus(payload.status)
      ) {
        throw new Error('Invalid conversation timeline payload');
      }
      return {
        requestId: payload.requestId,
        title: payload.title,
        body: payload.body,
        input: payload.input,
        options: payload.options,
        status: payload.status,
      };
    }
    case 'error': {
      if (typeof payload.message !== 'string') {
        throw new Error('Invalid conversation timeline payload');
      }
      return { message: payload.message };
    }
  }
}

function isToolCallStatus(
  value: unknown
): value is ConversationTimelineItemPayload<'tool_call'>['status'] {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

function isPermissionOptions(value: unknown): value is ConversationPermissionOption[] {
  return (
    Array.isArray(value) &&
    value.every(
      (option) =>
        typeof option === 'object' &&
        option !== null &&
        typeof option.id === 'string' &&
        typeof option.label === 'string' &&
        (option.kind === undefined ||
          option.kind === 'primary' ||
          option.kind === 'secondary' ||
          option.kind === 'danger')
    )
  );
}

function isPermissionStatus(
  value: unknown
): value is ConversationTimelineItemPayload<'permission_request'>['status'] {
  return value === 'pending' || value === 'approved' || value === 'denied' || value === 'cancelled';
}

function payloadForUpsert(
  existing: typeof conversationTimelineItems.$inferSelect,
  nextPayload: Record<string, unknown>
): Record<string, unknown> {
  if (existing.kind !== 'permission_request' || nextPayload.status !== 'pending') {
    return nextPayload;
  }
  const existingPayload = validatePayload(
    'permission_request',
    parsePayload(existing.payload)
  ) as ConversationTimelineItemPayload<'permission_request'>;
  if (existingPayload.status === 'pending') {
    return nextPayload;
  }
  return existingPayload;
}

export class ChatTimelineStore {
  constructor(private readonly storeDb?: AppDb) {}

  private get db(): AppDb {
    return this.storeDb ?? defaultDb;
  }

  async requireChatConversation(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Promise<Conversation> {
    const [row] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.projectId, projectId),
          eq(conversations.taskId, taskId)
        )
      )
      .limit(1);
    if (!row) throw new Error('Conversation not found');

    const conversation = mapConversationRowToConversation(row);
    if (!shouldUseChatRuntime(conversation)) {
      throw new Error('Conversation does not use chat runtime');
    }
    return conversation;
  }

  async append(
    conversation: Conversation,
    input: AppendConversationTimelineItemInput,
    options: { emit?: boolean; upsert?: boolean } = {}
  ): Promise<ConversationTimelineItem> {
    validatePayload(input.kind, input.payload as Record<string, unknown>);
    const persisted = await this.requireChatConversation(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );

    const payload =
      options.emit === false && input.kind === 'user_message'
        ? { ...input.payload, deliveryStatus: PENDING_DELIVERY_STATUS }
        : input.payload;

    const storedId =
      options.upsert === true && input.id ? stableTimelineItemId(persisted.id, input.id) : input.id;

    const [row] = this.db.transaction((tx) => {
      if (options.upsert === true && input.id) {
        const upsertId = stableTimelineItemId(persisted.id, input.id);
        const [existing] = tx
          .select()
          .from(conversationTimelineItems)
          .where(
            and(
              or(
                eq(conversationTimelineItems.id, input.id),
                eq(conversationTimelineItems.id, upsertId)
              ),
              eq(conversationTimelineItems.conversationId, persisted.id)
            )
          )
          .limit(1)
          .all();
        if (existing) {
          if (existing.kind !== input.kind) {
            throw new Error('Conversation timeline item kind mismatch');
          }
          const updatedPayload = payloadForUpsert(existing, payload);
          return tx
            .update(conversationTimelineItems)
            .set({ payload: JSON.stringify(updatedPayload) })
            .where(eq(conversationTimelineItems.id, existing.id))
            .returning()
            .all();
        }
      }

      const [maxRow] = tx
        .select({ value: sql<number>`coalesce(max(${conversationTimelineItems.sequence}), 0)` })
        .from(conversationTimelineItems)
        .where(eq(conversationTimelineItems.conversationId, persisted.id))
        .all();

      return tx
        .insert(conversationTimelineItems)
        .values({
          id: storedId ?? randomUUID(),
          conversationId: persisted.id,
          sequence: (maxRow?.value ?? 0) + 1,
          kind: input.kind,
          payload: JSON.stringify(payload),
        })
        .returning()
        .all();
    });

    const item =
      input.id && options.upsert === true
        ? restoreStableTimelineItemId(persisted.id, rowToTimelineItem(row))
        : rowToTimelineItem(row);
    if (input.id && options.upsert === true) {
      if (options.emit !== false) {
        this.emitTimelineItem(persisted, item);
      }
      return item;
    }
    if (options.emit !== false) {
      this.emitTimelineItem(persisted, item);
    }
    return item;
  }

  async getPendingPermissionRequest(
    conversation: Conversation,
    response: ConversationPermissionResponse
  ): Promise<ConversationPermissionRequestTimelineItem> {
    const item = await this.findPermissionRequest(conversation, response.requestId);
    if (!item) throw new Error('Permission request not found');
    if (item.status !== 'pending') throw new Error('Permission request is not pending');
    if (!item.options.some((option) => option.id === response.optionId)) {
      throw new Error('Permission option not found');
    }
    return item;
  }

  async resolvePermissionRequest(
    conversation: Conversation,
    response: ConversationPermissionResponse
  ): Promise<ConversationPermissionRequestTimelineItem> {
    const request = await this.getPendingPermissionRequest(conversation, response);
    const option = request.options.find((candidate) => candidate.id === response.optionId);
    if (!option) throw new Error('Permission option not found');
    const status = permissionResponseStatus(option);
    const payload = JSON.stringify({
      requestId: request.requestId,
      title: request.title,
      body: request.body,
      input: request.input,
      options: request.options,
      status,
    });
    const [row] = await this.db
      .update(conversationTimelineItems)
      .set({ payload })
      .where(
        and(
          eq(conversationTimelineItems.conversationId, conversation.id),
          eq(conversationTimelineItems.kind, 'permission_request'),
          or(
            eq(conversationTimelineItems.id, request.id),
            eq(conversationTimelineItems.id, stableTimelineItemId(conversation.id, request.id))
          ),
          sql`case when json_valid(${conversationTimelineItems.payload}) then json_extract(${conversationTimelineItems.payload}, '$.status') else null end = 'pending'`
        )
      )
      .returning();
    if (!row) throw new Error('Permission request is not pending');
    const updated = restoreStableTimelineItemId(
      conversation.id,
      rowToTimelineItem(row)
    ) as ConversationPermissionRequestTimelineItem;
    this.emitTimelineItem(conversation, updated);
    return updated;
  }

  async reopenCancelledPermissionRequest(
    conversation: Conversation,
    input: Extract<AppendConversationTimelineItemInput, { kind: 'permission_request' }>,
    cancelledIds: readonly string[]
  ): Promise<ConversationPermissionRequestTimelineItem | undefined> {
    if (input.payload.status !== 'pending' || cancelledIds.length === 0) return undefined;
    validatePayload(input.kind, input.payload as Record<string, unknown>);
    const persisted = await this.requireChatConversation(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    const scopedIds = cancelledIds.flatMap((id) => [id, stableTimelineItemId(persisted.id, id)]);
    const exactIds =
      input.id && scopedIds.includes(input.id)
        ? [input.id, stableTimelineItemId(persisted.id, input.id)]
        : undefined;
    const payload = JSON.stringify(input.payload);
    const [row] = this.db.transaction((tx) => {
      const [candidate] = tx
        .select()
        .from(conversationTimelineItems)
        .where(
          and(
            eq(conversationTimelineItems.conversationId, persisted.id),
            eq(conversationTimelineItems.kind, 'permission_request'),
            inArray(conversationTimelineItems.id, exactIds ?? scopedIds),
            sql`case when json_valid(${conversationTimelineItems.payload}) then json_extract(${conversationTimelineItems.payload}, '$.status') else null end = 'cancelled'`
          )
        )
        .orderBy(desc(conversationTimelineItems.sequence))
        .limit(1)
        .all();
      if (!candidate) return [];
      return tx
        .update(conversationTimelineItems)
        .set({ payload })
        .where(eq(conversationTimelineItems.id, candidate.id))
        .returning()
        .all();
    });
    if (!row) return undefined;
    const updated = restoreStableTimelineItemId(
      persisted.id,
      rowToTimelineItem(row)
    ) as ConversationPermissionRequestTimelineItem;
    this.emitTimelineItem(persisted, updated);
    return updated;
  }

  async restoreCancelledPermissionRequests(
    conversation: Conversation,
    ids: readonly string[]
  ): Promise<ConversationPermissionRequestTimelineItem[]> {
    if (ids.length === 0) return [];
    const scopedIds = ids.flatMap((id) => [id, stableTimelineItemId(conversation.id, id)]);
    const rows = await this.db
      .select()
      .from(conversationTimelineItems)
      .where(
        and(
          eq(conversationTimelineItems.conversationId, conversation.id),
          eq(conversationTimelineItems.kind, 'permission_request'),
          inArray(conversationTimelineItems.id, scopedIds),
          sql`case when json_valid(${conversationTimelineItems.payload}) then json_extract(${conversationTimelineItems.payload}, '$.status') else null end = 'cancelled'`
        )
      );
    const restored: ConversationPermissionRequestTimelineItem[] = [];
    for (const row of rows) {
      const item = restoreStableTimelineItemId(
        conversation.id,
        rowToTimelineItem(row)
      ) as ConversationPermissionRequestTimelineItem;
      const payload = JSON.stringify({
        requestId: item.requestId,
        title: item.title,
        body: item.body,
        input: item.input,
        options: item.options,
        status: 'pending',
      });
      const [updatedRow] = await this.db
        .update(conversationTimelineItems)
        .set({ payload })
        .where(
          and(
            eq(conversationTimelineItems.id, row.id),
            sql`case when json_valid(${conversationTimelineItems.payload}) then json_extract(${conversationTimelineItems.payload}, '$.status') else null end = 'cancelled'`
          )
        )
        .returning();
      if (!updatedRow) continue;
      const updated = restoreStableTimelineItemId(
        conversation.id,
        rowToTimelineItem(updatedRow)
      ) as ConversationPermissionRequestTimelineItem;
      restored.push(updated);
      this.emitTimelineItem(conversation, updated);
    }
    return restored;
  }

  async restorePendingPermissionRequest(
    conversation: Conversation,
    request: ConversationPermissionRequestTimelineItem
  ): Promise<ConversationPermissionRequestTimelineItem> {
    const payload = JSON.stringify({
      requestId: request.requestId,
      title: request.title,
      body: request.body,
      input: request.input,
      options: request.options,
      status: 'pending',
    });
    const [row] = await this.db
      .update(conversationTimelineItems)
      .set({ payload })
      .where(
        and(
          eq(conversationTimelineItems.conversationId, conversation.id),
          eq(conversationTimelineItems.kind, 'permission_request'),
          or(
            eq(conversationTimelineItems.id, request.id),
            eq(conversationTimelineItems.id, stableTimelineItemId(conversation.id, request.id))
          ),
          sql`case when json_valid(${conversationTimelineItems.payload}) then json_extract(${conversationTimelineItems.payload}, '$.status') else null end in ('approved', 'denied')`
        )
      )
      .returning();
    if (!row) throw new Error('Permission request could not be restored');
    const restored = restoreStableTimelineItemId(
      conversation.id,
      rowToTimelineItem(row)
    ) as ConversationPermissionRequestTimelineItem;
    this.emitTimelineItem(conversation, restored);
    return restored;
  }

  async cancelPendingPermissionRequests(
    conversation: Conversation
  ): Promise<ConversationPermissionRequestTimelineItem[]> {
    const requests = await this.listPendingPermissionRequests(conversation);
    const cancelled: ConversationPermissionRequestTimelineItem[] = [];
    for (const request of requests) {
      const payload = JSON.stringify({
        requestId: request.requestId,
        title: request.title,
        body: request.body,
        input: request.input,
        options: request.options,
        status: 'cancelled',
      });
      const [row] = await this.db
        .update(conversationTimelineItems)
        .set({ payload })
        .where(
          and(
            eq(conversationTimelineItems.conversationId, conversation.id),
            eq(conversationTimelineItems.kind, 'permission_request'),
            or(
              eq(conversationTimelineItems.id, request.id),
              eq(conversationTimelineItems.id, stableTimelineItemId(conversation.id, request.id))
            ),
            sql`case when json_valid(${conversationTimelineItems.payload}) then json_extract(${conversationTimelineItems.payload}, '$.status') else null end = 'pending'`
          )
        )
        .returning();
      if (!row) continue;
      const item = restoreStableTimelineItemId(
        conversation.id,
        rowToTimelineItem(row)
      ) as ConversationPermissionRequestTimelineItem;
      cancelled.push(item);
      this.emitTimelineItem(conversation, item);
    }
    return cancelled;
  }

  async appendUserMessage(
    conversation: Conversation,
    input: SendConversationMessageInput | string,
    options: { emit?: boolean } = {}
  ): Promise<ConversationMessageTimelineItem> {
    const text = (typeof input === 'string' ? input : input.text).trim();
    if (!text) throw new Error('Message text is required');

    return this.append(
      conversation,
      {
        id: typeof input === 'string' ? undefined : input.messageId,
        kind: 'user_message',
        payload: { text },
      },
      options
    ) as Promise<ConversationMessageTimelineItem>;
  }

  async emitItem(conversation: Conversation, item: ConversationTimelineItem): Promise<void> {
    if (item.kind === 'user_message') {
      const [updatedRow] = await this.db
        .update(conversationTimelineItems)
        .set({ payload: JSON.stringify({ text: item.text }) })
        .where(
          and(
            eq(conversationTimelineItems.id, item.id),
            eq(conversationTimelineItems.conversationId, conversation.id),
            notCancelledDeliveryPredicate()
          )
        )
        .returning();
      if (!updatedRow) return;
    }
    this.emitTimelineItem(conversation, item);
  }

  async markUserMessageDeliveryStarted(
    conversation: Conversation,
    item: ConversationMessageTimelineItem
  ): Promise<void> {
    await this.db
      .update(conversationTimelineItems)
      .set({
        payload: JSON.stringify({
          text: item.text,
          deliveryStatus: DELIVERY_STARTED_STATUS,
        }),
      })
      .where(
        and(
          eq(conversationTimelineItems.id, item.id),
          eq(conversationTimelineItems.conversationId, conversation.id),
          notCancelledDeliveryPredicate()
        )
      )
      .execute();
  }

  async markUserMessageDelivered(
    conversation: Conversation,
    item: ConversationMessageTimelineItem
  ): Promise<void> {
    await this.db
      .update(conversationTimelineItems)
      .set({
        payload: JSON.stringify({
          text: item.text,
          deliveryStatus: DELIVERED_PENDING_EMIT_STATUS,
        }),
      })
      .where(
        and(
          eq(conversationTimelineItems.id, item.id),
          eq(conversationTimelineItems.conversationId, conversation.id),
          deliveredDeliveryPredicate()
        )
      )
      .execute();
  }

  async markUserMessageCancelled(
    conversation: Conversation,
    item: ConversationMessageTimelineItem
  ): Promise<void> {
    await this.db
      .update(conversationTimelineItems)
      .set({
        payload: JSON.stringify({
          text: item.text,
          deliveryStatus: CANCELLED_DELIVERY_STATUS,
        }),
      })
      .where(
        and(
          eq(conversationTimelineItems.id, item.id),
          eq(conversationTimelineItems.conversationId, conversation.id),
          cancellableDeliveryPredicate()
        )
      )
      .execute();
  }

  async deleteItem(conversation: Conversation, itemId: string): Promise<void> {
    await this.db
      .delete(conversationTimelineItems)
      .where(
        and(
          eq(conversationTimelineItems.id, itemId),
          eq(conversationTimelineItems.conversationId, conversation.id),
          deletableSilentItemPredicate()
        )
      )
      .execute();
  }

  async recoverPendingUserMessages(conversation: Conversation): Promise<void> {
    const rows = await this.db
      .select({ id: conversationTimelineItems.id, payload: conversationTimelineItems.payload })
      .from(conversationTimelineItems)
      .where(
        and(
          eq(conversationTimelineItems.conversationId, conversation.id),
          eq(conversationTimelineItems.kind, 'user_message')
        )
      );
    for (const row of rows) {
      const recovery = recoverPendingDeliveryPayload(row.payload);
      if (!recovery) continue;
      if (recovery.action === 'delete') {
        await this.db
          .delete(conversationTimelineItems)
          .where(
            and(
              eq(conversationTimelineItems.conversationId, conversation.id),
              eq(conversationTimelineItems.id, row.id)
            )
          )
          .execute();
        continue;
      }
      this.db.transaction((tx) => {
        tx.update(conversationTimelineItems)
          .set({ payload: recovery.payload })
          .where(
            and(
              eq(conversationTimelineItems.conversationId, conversation.id),
              eq(conversationTimelineItems.id, row.id)
            )
          )
          .run();

        if (!recovery.warning) return;
        const [maxRow] = tx
          .select({ value: sql<number>`coalesce(max(${conversationTimelineItems.sequence}), 0)` })
          .from(conversationTimelineItems)
          .where(eq(conversationTimelineItems.conversationId, conversation.id))
          .all();
        tx.insert(conversationTimelineItems)
          .values({
            id: randomUUID(),
            conversationId: conversation.id,
            sequence: (maxRow?.value ?? 0) + 1,
            kind: 'error',
            payload: JSON.stringify({ message: recovery.warning }),
          })
          .run();
      });
    }
  }

  async listTimeline(
    projectId: string,
    taskId: string,
    conversationId: string,
    options: ConversationTimelineListOptions = {}
  ): Promise<ConversationTimelineItem[]> {
    await this.requireChatConversation(projectId, taskId, conversationId);
    return this.list(conversationId, options);
  }

  private async list(
    conversationId: string,
    options: ConversationTimelineListOptions = {}
  ): Promise<ConversationTimelineItem[]> {
    if (options.afterSequence === undefined) {
      const rows = await this.db
        .select()
        .from(conversationTimelineItems)
        .where(
          and(
            eq(conversationTimelineItems.conversationId, conversationId),
            deliveredTimelinePayloadPredicate()
          )
        )
        .orderBy(desc(conversationTimelineItems.sequence))
        .limit(normalizeLimit(options.limit));

      return rows
        .reverse()
        .map((row) => restoreStableTimelineItemId(conversationId, rowToTimelineItem(row)));
    }

    const rows = await this.db
      .select()
      .from(conversationTimelineItems)
      .where(
        and(
          eq(conversationTimelineItems.conversationId, conversationId),
          gt(conversationTimelineItems.sequence, options.afterSequence),
          deliveredTimelinePayloadPredicate()
        )
      )
      .orderBy(asc(conversationTimelineItems.sequence))
      .limit(normalizeLimit(options.limit));

    return rows.map((row) => restoreStableTimelineItemId(conversationId, rowToTimelineItem(row)));
  }

  async getLatestAssistantMessage(conversationId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select()
      .from(conversationTimelineItems)
      .where(
        and(
          eq(conversationTimelineItems.conversationId, conversationId),
          eq(conversationTimelineItems.kind, 'assistant_message')
        )
      )
      .orderBy(desc(conversationTimelineItems.sequence))
      .limit(1);

    if (!row) return undefined;
    const item = rowToTimelineItem(row);
    return item.kind === 'assistant_message' ? item.text : undefined;
  }

  private emitTimelineItem(conversation: Conversation, item: ConversationTimelineItem): void {
    events.emit(conversationTimelineEventChannel, {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
      item,
    });
  }

  private async findPermissionRequest(
    conversation: Conversation,
    requestId: string
  ): Promise<ConversationPermissionRequestTimelineItem | undefined> {
    await this.requireChatConversation(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    const [row] = await this.db
      .select()
      .from(conversationTimelineItems)
      .where(
        and(
          eq(conversationTimelineItems.conversationId, conversation.id),
          eq(conversationTimelineItems.kind, 'permission_request'),
          sql`case when json_valid(${conversationTimelineItems.payload}) then json_extract(${conversationTimelineItems.payload}, '$.requestId') else null end = ${requestId}`
        )
      )
      .orderBy(desc(conversationTimelineItems.sequence))
      .limit(1);
    if (!row) return undefined;
    return restoreStableTimelineItemId(
      conversation.id,
      rowToTimelineItem(row)
    ) as ConversationPermissionRequestTimelineItem;
  }

  private async listPendingPermissionRequests(
    conversation: Conversation
  ): Promise<ConversationPermissionRequestTimelineItem[]> {
    await this.requireChatConversation(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
    const rows = await this.db
      .select()
      .from(conversationTimelineItems)
      .where(
        and(
          eq(conversationTimelineItems.conversationId, conversation.id),
          eq(conversationTimelineItems.kind, 'permission_request'),
          sql`case when json_valid(${conversationTimelineItems.payload}) then json_extract(${conversationTimelineItems.payload}, '$.status') else null end = 'pending'`
        )
      )
      .orderBy(asc(conversationTimelineItems.sequence));
    return rows.map((row) => {
      return restoreStableTimelineItemId(
        conversation.id,
        rowToTimelineItem(row)
      ) as ConversationPermissionRequestTimelineItem;
    });
  }
}

export const chatTimelineStore = new ChatTimelineStore();

function permissionResponseStatus(
  option: ConversationPermissionOption
): ConversationTimelineItemPayload<'permission_request'>['status'] {
  const normalizedId = option.id.toLowerCase();
  const normalizedLabel = option.label.toLowerCase();
  if (
    option.kind === 'danger' ||
    normalizedId === 'deny' ||
    normalizedId === 'reject' ||
    normalizedLabel === 'deny' ||
    normalizedLabel === 'reject'
  ) {
    return 'denied';
  }
  return 'approved';
}
