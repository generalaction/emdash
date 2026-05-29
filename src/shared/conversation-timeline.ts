export const CONVERSATION_TIMELINE_ITEM_KINDS = [
  'user_message',
  'assistant_message',
  'reasoning',
  'tool_call',
  'permission_request',
  'error',
] as const;

export type ConversationTimelineItemKind = (typeof CONVERSATION_TIMELINE_ITEM_KINDS)[number];

export type ConversationTimelineItemBase = {
  id: string;
  conversationId: string;
  sequence: number;
  createdAt: string;
};

export type ConversationMessageTimelineItem = ConversationTimelineItemBase & {
  kind: 'user_message' | 'assistant_message';
  text: string;
};

export type ConversationReasoningTimelineItem = ConversationTimelineItemBase & {
  kind: 'reasoning';
  text: string;
};

export type ConversationToolCallStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ConversationToolCallTimelineItem = ConversationTimelineItemBase & {
  kind: 'tool_call';
  toolName: string;
  status: ConversationToolCallStatus;
  input?: unknown;
  output?: string;
  error?: string;
};

export type ConversationPermissionOption = {
  id: string;
  label: string;
  kind?: 'primary' | 'secondary' | 'danger';
};

export type ConversationPermissionRequestTimelineItem = ConversationTimelineItemBase & {
  kind: 'permission_request';
  requestId: string;
  title: string;
  body?: string;
  input?: unknown;
  options: ConversationPermissionOption[];
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
};

export type ConversationErrorTimelineItem = ConversationTimelineItemBase & {
  kind: 'error';
  message: string;
};

export type ConversationTimelineItem =
  | ConversationMessageTimelineItem
  | ConversationReasoningTimelineItem
  | ConversationToolCallTimelineItem
  | ConversationPermissionRequestTimelineItem
  | ConversationErrorTimelineItem;

export type ConversationTimelineItemPayloadByKind = {
  user_message: { text: string };
  assistant_message: { text: string };
  reasoning: Omit<
    ConversationReasoningTimelineItem,
    'id' | 'conversationId' | 'sequence' | 'kind' | 'createdAt'
  >;
  tool_call: Omit<
    ConversationToolCallTimelineItem,
    'id' | 'conversationId' | 'sequence' | 'kind' | 'createdAt'
  >;
  permission_request: Omit<
    ConversationPermissionRequestTimelineItem,
    'id' | 'conversationId' | 'sequence' | 'kind' | 'createdAt'
  >;
  error: Omit<
    ConversationErrorTimelineItem,
    'id' | 'conversationId' | 'sequence' | 'kind' | 'createdAt'
  >;
};

export type ConversationTimelineItemPayload<
  TKind extends ConversationTimelineItemKind = ConversationTimelineItemKind,
> = ConversationTimelineItemPayloadByKind[TKind];

export type ConversationTimelineListOptions = {
  afterSequence?: number;
  limit?: number;
};

export type AppendConversationTimelineItemInput = {
  [TKind in ConversationTimelineItemKind]: {
    id?: string;
    kind: TKind;
    payload: ConversationTimelineItemPayload<TKind>;
  };
}[ConversationTimelineItemKind];

export type SendConversationMessageInput = {
  messageId?: string;
  text: string;
};

export type SendConversationMessageResult = {
  item?: ConversationMessageTimelineItem;
};

export type ConversationPermissionResponse = {
  answers?: Record<string, string | string[]>;
  requestId: string;
  optionId: string;
};

export type ConversationStatus = 'idle' | 'working' | 'awaiting-input' | 'error' | 'completed';
