import type { NativeChatItem } from '@shared/native-chat';
import type { NativeChatTurnEvent } from './native-exec-events';

/**
 * Stateful parser for one `claude -p --output-format stream-json --verbose`
 * turn, mapping Claude Code's event stream onto the shared transcript items:
 *
 *   {"type":"system","subtype":"init","session_id":"..."}
 *   {"type":"assistant","message":{"content":[{"type":"thinking"|"text"|"tool_use",...}]}}
 *   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":...,...}]}}
 *   {"type":"result","subtype":"success"|"error_*","result":"...","session_id":"..."}
 *
 * Tool calls arrive as `tool_use` blocks and complete via matching
 * `tool_result` blocks, so the parser keeps per-turn state to upsert the same
 * item key. Unknown events (hooks, rate limits) are ignored.
 */
export type ClaudeStreamParser = {
  parseLine(line: string): NativeChatTurnEvent[];
};

type PendingTool = { item: NativeChatItem };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** tool_result content is a string or an array of {type:'text',text} blocks. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) => {
      const record = asRecord(block);
      const text = record && asString(record.text);
      return text ? [text] : [];
    })
    .join('\n');
}

const FILE_TOOL_KINDS: Record<string, string> = {
  Write: 'add',
  Edit: 'update',
  MultiEdit: 'update',
  NotebookEdit: 'update',
};

export function createClaudeStreamParser(itemKeyPrefix: string): ClaudeStreamParser {
  let blockSeq = 0;
  const pendingTools = new Map<string, PendingTool>();

  const nextKey = () => `${itemKeyPrefix}:b${blockSeq++}`;

  function mapToolUse(block: Record<string, unknown>): NativeChatItem | null {
    const name = asString(block.name) ?? '';
    const input = asRecord(block.input) ?? {};
    const key = nextKey();

    if (name === 'Bash') {
      return {
        kind: 'command_execution',
        key,
        command: asString(input.command) ?? '',
        aggregatedOutput: '',
        exitCode: null,
        status: 'in_progress',
      };
    }
    if (name in FILE_TOOL_KINDS) {
      const path = asString(input.file_path) ?? asString(input.notebook_path);
      return {
        kind: 'file_change',
        key,
        changes: path ? [{ path, kind: FILE_TOOL_KINDS[name] }] : [],
        status: 'in_progress',
      };
    }
    if (name === 'WebSearch') {
      return { kind: 'web_search', key, query: asString(input.query) ?? '' };
    }
    if (name === 'TodoWrite') {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      return {
        kind: 'todo_list',
        key,
        items: todos.flatMap((todo) => {
          const record = asRecord(todo);
          const text = record && asString(record.content);
          if (!text) return [];
          return [{ text, completed: record.status === 'completed' }];
        }),
      };
    }
    const mcpMatch = /^mcp__(.+?)__(.+)$/.exec(name);
    if (mcpMatch) {
      return {
        kind: 'mcp_tool_call',
        key,
        server: mcpMatch[1],
        tool: mcpMatch[2],
        status: 'in_progress',
      };
    }
    // Read, Glob, Grep, Task, WebFetch, Skill, ... — render as a generic tool row.
    return { kind: 'mcp_tool_call', key, server: '', tool: name, status: 'in_progress' };
  }

  function completeTool(block: Record<string, unknown>): NativeChatTurnEvent[] {
    const toolUseId = asString(block.tool_use_id);
    const pending = toolUseId ? pendingTools.get(toolUseId) : undefined;
    if (!toolUseId || !pending) return [];
    pendingTools.delete(toolUseId);

    const failed = block.is_error === true;
    const item = pending.item;
    if (item.kind === 'command_execution') {
      return [
        {
          type: 'item',
          item: {
            ...item,
            aggregatedOutput: toolResultText(block.content),
            exitCode: failed ? 1 : 0,
            status: failed ? 'failed' : 'completed',
          },
        },
      ];
    }
    if (item.kind === 'file_change' || item.kind === 'mcp_tool_call') {
      return [{ type: 'item', item: { ...item, status: failed ? 'failed' : 'completed' } }];
    }
    return [];
  }

  function mapAssistantBlocks(content: unknown): NativeChatTurnEvent[] {
    if (!Array.isArray(content)) return [];
    const events: NativeChatTurnEvent[] = [];
    for (const rawBlock of content) {
      const block = asRecord(rawBlock);
      if (!block) continue;
      switch (asString(block.type)) {
        case 'text': {
          const text = asString(block.text) ?? '';
          if (text.trim()) {
            events.push({ type: 'item', item: { kind: 'agent_message', key: nextKey(), text } });
          }
          break;
        }
        case 'thinking': {
          const text = asString(block.thinking) ?? '';
          if (text.trim()) {
            events.push({ type: 'item', item: { kind: 'reasoning', key: nextKey(), text } });
          }
          break;
        }
        case 'tool_use': {
          const item = mapToolUse(block);
          const toolUseId = asString(block.id);
          if (item) {
            if (toolUseId) pendingTools.set(toolUseId, { item });
            events.push({ type: 'item', item });
          }
          break;
        }
        default:
          break;
      }
    }
    return events;
  }

  return {
    parseLine(line: string): NativeChatTurnEvent[] {
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
        case 'system': {
          if (record.subtype !== 'init') return [];
          const sessionId = asString(record.session_id);
          return sessionId ? [{ type: 'thread-started', threadId: sessionId }] : [];
        }
        case 'assistant': {
          const message = asRecord(record.message);
          return message ? mapAssistantBlocks(message.content) : [];
        }
        case 'user': {
          const message = asRecord(record.message);
          const content = message?.content;
          if (!Array.isArray(content)) return [];
          return content.flatMap((rawBlock) => {
            const block = asRecord(rawBlock);
            return block && asString(block.type) === 'tool_result' ? completeTool(block) : [];
          });
        }
        case 'result': {
          if (record.is_error === true) {
            const message =
              asString(record.result) ??
              `Claude turn failed (${asString(record.subtype) ?? 'error'})`;
            return [{ type: 'turn-failed', message }];
          }
          // Final text already arrived as an assistant block; nothing to add.
          return [{ type: 'turn-completed' }];
        }
        default:
          return [];
      }
    },
  };
}
