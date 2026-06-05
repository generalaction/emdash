import type { CodexChatItem } from '@shared/native-chat';
import type { CodexExecEvent } from './codex-exec-events';

/**
 * Stateful parser for one `pi --mode json --print` turn.
 *
 * Pi emits JSONL session and agent events:
 *   {"type":"session","id":"..."}
 *   {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"..."}}
 *   {"type":"tool_execution_start","toolCallId":"...","toolName":"bash","args":{...}}
 *   {"type":"tool_execution_update","toolCallId":"...","partialResult":{...}}
 *   {"type":"tool_execution_end","toolCallId":"...","result":{...},"isError":false}
 *   {"type":"agent_end",...}
 */
export type PiStreamParser = {
  parseLine(line: string): CodexExecEvent[];
};

type PendingTool = { item: CodexChatItem };
type StreamBlockKind = 'agent_message' | 'reasoning';
type StreamBlock = { key: string; kind: StreamBlockKind; text: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function textFromContentBlocks(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .flatMap((block) => {
      const record = asRecord(block);
      const text = record && asString(record.text);
      return text ? [text] : [];
    })
    .join('\n');
}

function textFromToolResult(value: unknown): string {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (!record) return '';
  const structured = textFromContentBlocks(record.content ?? record.output ?? record.text);
  if (structured) return structured;
  return [asString(record.stdout), asString(record.stderr)].filter(Boolean).join('\n');
}

function filePathFromArgs(args: Record<string, unknown>): string | undefined {
  return (
    asString(args.path) ??
    asString(args.file) ??
    asString(args.filePath) ??
    asString(args.file_path)
  );
}

function mapToolStart(key: string, toolName: string, args: Record<string, unknown>): CodexChatItem {
  const path = filePathFromArgs(args);
  switch (toolName) {
    case 'bash':
      return {
        kind: 'command_execution',
        key,
        command: asString(args.command) ?? '',
        aggregatedOutput: '',
        exitCode: null,
        status: 'in_progress',
      };
    case 'write':
      return {
        kind: 'file_change',
        key,
        changes: path ? [{ path, kind: 'add' }] : [],
        status: 'in_progress',
      };
    case 'edit':
      return {
        kind: 'file_change',
        key,
        changes: path ? [{ path, kind: 'update' }] : [],
        status: 'in_progress',
      };
    default:
      return { kind: 'mcp_tool_call', key, server: '', tool: toolName, status: 'in_progress' };
  }
}

function completeToolItem(
  item: CodexChatItem,
  result: unknown,
  failed: boolean
): CodexChatItem | null {
  if (item.kind === 'command_execution') {
    const record = asRecord(result);
    const exitCode =
      typeof record?.exitCode === 'number'
        ? record.exitCode
        : typeof record?.exit_code === 'number'
          ? record.exit_code
          : failed
            ? 1
            : 0;
    return {
      ...item,
      aggregatedOutput: textFromToolResult(result),
      exitCode,
      status: failed || exitCode !== 0 ? 'failed' : 'completed',
    };
  }
  if (item.kind === 'file_change' || item.kind === 'mcp_tool_call') {
    return { ...item, status: failed ? 'failed' : 'completed' };
  }
  return null;
}

export function createPiStreamParser(itemKeyPrefix: string): PiStreamParser {
  let blockSeq = 0;
  const streamBlocks = new Map<string, StreamBlock>();
  const pendingTools = new Map<string, PendingTool>();

  const nextKey = () => `${itemKeyPrefix}:p${blockSeq++}`;

  function blockFor(contentIndex: unknown, kind: StreamBlockKind): StreamBlock {
    const id = `${kind}:${typeof contentIndex === 'number' ? contentIndex : 0}`;
    const existing = streamBlocks.get(id);
    if (existing) return existing;
    const block = { key: nextKey(), kind, text: '' };
    streamBlocks.set(id, block);
    return block;
  }

  function mapMessageUpdate(event: Record<string, unknown>): CodexExecEvent[] {
    const update = asRecord(event.assistantMessageEvent);
    if (!update) return [];
    const updateType = asString(update.type);
    const contentIndex = update.contentIndex;

    if (updateType === 'text_start') {
      blockFor(contentIndex, 'agent_message');
      return [];
    }
    if (updateType === 'thinking_start') {
      blockFor(contentIndex, 'reasoning');
      return [];
    }
    if (updateType === 'text_delta') {
      const block = blockFor(contentIndex, 'agent_message');
      block.text += asString(update.delta) ?? '';
      return block.text
        ? [{ type: 'item', item: { kind: 'agent_message', key: block.key, text: block.text } }]
        : [];
    }
    if (updateType === 'thinking_delta') {
      const block = blockFor(contentIndex, 'reasoning');
      block.text += asString(update.delta) ?? '';
      return block.text
        ? [{ type: 'item', item: { kind: 'reasoning', key: block.key, text: block.text } }]
        : [];
    }
    if (updateType === 'error') {
      return [{ type: 'turn-failed', message: asString(update.reason) ?? 'Pi turn failed' }];
    }
    return [];
  }

  return {
    parseLine(line: string): CodexExecEvent[] {
      const trimmed = line.trim();
      if (!trimmed) return [];

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return [];
      }
      const record = asRecord(parsed);
      if (!record) return [];

      switch (asString(record.type)) {
        case 'session': {
          const sessionId = asString(record.id);
          return sessionId ? [{ type: 'thread-started', threadId: sessionId }] : [];
        }
        case 'turn_start':
        case 'agent_start':
          return [{ type: 'turn-started' }];
        case 'message_update':
          return mapMessageUpdate(record);
        case 'tool_execution_start': {
          const toolCallId = asString(record.toolCallId);
          const toolName = asString(record.toolName) ?? 'tool';
          const args = asRecord(record.args) ?? {};
          const key = `${itemKeyPrefix}:${toolCallId ?? `tool_${blockSeq++}`}`;
          const item = mapToolStart(key, toolName, args);
          if (toolCallId) pendingTools.set(toolCallId, { item });
          return [{ type: 'item', item }];
        }
        case 'tool_execution_update': {
          const toolCallId = asString(record.toolCallId);
          const pending = toolCallId ? pendingTools.get(toolCallId) : undefined;
          if (!pending || pending.item.kind !== 'command_execution') return [];
          const item = {
            ...pending.item,
            aggregatedOutput: textFromToolResult(record.partialResult),
          };
          pending.item = item;
          return [{ type: 'item', item }];
        }
        case 'tool_execution_end': {
          const toolCallId = asString(record.toolCallId);
          const pending = toolCallId ? pendingTools.get(toolCallId) : undefined;
          if (!toolCallId || !pending) return [];
          pendingTools.delete(toolCallId);
          const item = completeToolItem(pending.item, record.result, record.isError === true);
          return item ? [{ type: 'item', item }] : [];
        }
        case 'extension_error':
          return [
            {
              type: 'item',
              item: {
                kind: 'error',
                key: nextKey(),
                message: asString(record.error) ?? 'Pi extension failed',
              },
            },
          ];
        case 'agent_end':
        case 'turn_end':
          return [{ type: 'turn-completed' }];
        case 'auto_retry_end':
          return record.success === false
            ? [{ type: 'turn-failed', message: asString(record.finalError) ?? 'Pi retry failed' }]
            : [];
        default:
          return [];
      }
    },
  };
}
