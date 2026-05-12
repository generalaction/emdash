import type { Conversation } from '@shared/conversations';
import { defineEvent } from '@shared/ipc/events';

/**
 * Broadcast when a conversation row is inserted (any path — UI flow,
 * MCP `agent_spawn`, etc.). Renderer subscribes to add the new tab to
 * its local store. UI-initiated creates dedupe by id.
 */
export const conversationCreatedChannel = defineEvent<Conversation>('conversation:created');
