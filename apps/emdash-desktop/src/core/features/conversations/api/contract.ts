import { defineContract, eventStream, procedure } from '@emdash/wire';
import { z } from 'zod';
import type {
  Conversation,
  ConversationEvent,
  CreateConversationParams,
} from '@core/primitives/conversations/api';

const conversationLocation = z.object({
  projectId: z.string(),
  taskId: z.string(),
  conversationId: z.string(),
});

export const conversationsContract = defineContract({
  getConversations: procedure({
    input: z.void(),
    output: z.custom<Conversation[]>(),
  }),
  createConversation: procedure({
    input: z.custom<CreateConversationParams>(),
    output: z.custom<Conversation>(),
  }),
  deleteConversation: procedure({
    input: conversationLocation,
    output: z.void(),
  }),
  hydrateConversation: procedure({
    input: conversationLocation,
    output: z.void(),
  }),
  dehydrateConversation: procedure({
    input: conversationLocation,
    output: z.void(),
  }),
  renameConversation: procedure({
    input: z.object({ conversationId: z.string(), name: z.string() }),
    output: z.void(),
  }),
  getConversationsForTask: procedure({
    input: z.object({ projectId: z.string(), taskId: z.string() }),
    output: z.custom<Conversation[]>(),
  }),
  getConversationsForProject: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.custom<Conversation[]>(),
  }),
  markConversationSeen: procedure({
    input: z.object({ conversationId: z.string() }),
    output: z.void(),
  }),
  events: eventStream({ key: z.void(), event: z.custom<ConversationEvent>() }),
});
