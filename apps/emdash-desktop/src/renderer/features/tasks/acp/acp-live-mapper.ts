import { finalizeTurn } from '@emdash/chat-ui';
import type { ChatImageAttachment, ChatItem, FileOpKind, ToolStatus } from '@emdash/chat-ui';
import type {
  ToolCallItem,
  ToolNode,
  TranscriptItem,
  TranscriptTurn,
} from '@emdash/core/acp/client';

export function mapTranscriptTurn(
  turn: TranscriptTurn,
  options: { active?: boolean } = {}
): ChatItem[] {
  const items = turn.items.flatMap((item) => mapTranscriptItem(item, options.active ?? false));
  return options.active ? items : finalizeTurn(items);
}

export function mapTranscriptTurns(turns: readonly TranscriptTurn[]): ChatItem[] {
  return turns.flatMap((turn) => mapTranscriptTurn(turn));
}

function mapTranscriptItem(item: TranscriptItem, active: boolean): ChatItem[] {
  switch (item.kind) {
    case 'message':
      return [
        {
          kind: 'message',
          id: item.id,
          role: item.role,
          text: item.text,
          streaming: active && item.role === 'assistant',
          attachments: item.attachments?.map(
            (attachment): ChatImageAttachment => ({
              id: attachment.id,
              name: attachment.name,
            })
          ),
        },
      ];
    case 'thinking':
      return [
        {
          kind: 'thinking',
          id: item.id,
          text: item.text,
          status: active ? item.status : 'done',
          startedAt: item.startedAt,
          durationMs: item.durationMs,
        },
      ];
    case 'tool-group':
      return item.children.flatMap((child) => mapToolNode(child, active));
    default:
      return mapToolNode(item, active);
  }
}

function mapToolNode(item: ToolNode, active: boolean): ChatItem[] {
  if (item.kind === 'tool-group') {
    return item.children.flatMap((child) => mapToolNode(child, active));
  }
  const mapped = mapToolCall(item, active);
  const children = item.children?.flatMap((child) => mapToolNode(child, active)) ?? [];
  return mapped ? [mapped, ...children] : children;
}

function mapToolCall(item: ToolCallItem, active: boolean): ChatItem | null {
  const status = mapStatus(item.status, active);
  switch (item.kind) {
    case 'execute-tool-call':
      return {
        kind: 'execute',
        id: item.id,
        command: item.command ?? item.title,
        status,
        startedAt: 0,
        parentId: item.parentToolCallId,
      };
    case 'read-tool-call':
      return {
        kind: 'file-op',
        id: item.id,
        op: 'read',
        status,
        ops: item.path ? [{ path: item.path }] : [],
        parentId: item.parentToolCallId,
      };
    case 'create-file-tool-call':
      return fileOp(item, 'edit', status);
    case 'modify-file-tool-call':
      return {
        kind: 'diff',
        id: item.id,
        path: item.path,
        oldText: item.oldText,
        newText: item.newText,
        status,
        parentId: item.parentToolCallId,
      };
    case 'delete-file-tool-call':
      return fileOp(item, 'delete', status);
    case 'create-plan-tool-call':
      return {
        kind: 'plan',
        id: item.id,
        entries: [],
        streaming: active,
      };
    case 'spawn-subagent-tool-call':
      return tool(item, status, item.background ? `${item.name} (background)` : item.name);
    case 'search-tool-call':
      return tool(item, status, item.query);
    case 'mcp-tool-call':
      return tool(item, status, item.server ? `${item.server}.${item.tool}` : item.tool);
    case 'web-fetch-tool-call':
      return tool(item, status, item.pageTitle ?? item.url);
    case 'unknown-tool-call':
      return tool(item, status, item.name);
  }
}

function fileOp(
  item: Extract<ToolCallItem, { path: string }>,
  op: FileOpKind,
  status: ToolStatus
): ChatItem {
  return {
    kind: 'file-op',
    id: item.id,
    op,
    status,
    ops: [{ path: item.path }],
    parentId: item.parentToolCallId,
  };
}

function tool(item: ToolCallItem, status: ToolStatus, inputSummary?: string): ChatItem {
  return {
    kind: 'tool',
    id: item.id,
    name: item.title,
    status,
    inputSummary: inputSummary ?? item.inputSummary,
    parentId: item.parentToolCallId,
  };
}

function mapStatus(status: ToolCallItem['status'], active: boolean): ToolStatus {
  switch (status) {
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    case 'running':
      return active ? 'running' : 'done';
  }
}
