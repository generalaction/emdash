/**
 * Baseline ACP SessionUpdate decoder.
 *
 * Converts raw ACP SDK SessionUpdate notifications into the parser's internal
 * NormalizedEvent vocabulary. This is the parser-owned equivalent of the
 * legacy toAgentUpdate in agent-update.ts — it is stateless, pure, and
 * handles all ACP-specific decoding:
 *
 *   - Extracts text from content blocks for message and thinking variants.
 *   - Extracts diff blocks from ToolCallContent arrays.
 *   - Passes status and kind through unchanged (no UI-level remapping here).
 *   - Preserves missing message ids for the stateful reducer to segment.
 *   - Sets parentToolCallId to null (providers enrich via EnrichHook).
 *   - Returns { kind: 'ignored' } for variants not yet rendered.
 */

import type { SessionUpdate, ToolCallContent } from '@agentclientprotocol/sdk';
import type { NormalizedDiff, NormalizedEvent, NormalizedToolStatus } from './normalized-event';

function extractDiffs(
  content: ReadonlyArray<ToolCallContent> | null | undefined
): NormalizedDiff[] {
  if (!content) return [];
  const diffs: NormalizedDiff[] = [];
  for (const block of content) {
    if (block.type === 'diff') {
      diffs.push({ path: block.path, oldText: block.oldText ?? null, newText: block.newText });
    }
  }
  return diffs;
}

function collectTextPayload(value: unknown, parts: string[]): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) collectTextPayload(item, parts);
    return;
  }

  const raw = value as { type?: unknown; text?: unknown; content?: unknown };
  if (raw.type === 'text' && typeof raw.text === 'string') {
    parts.push(raw.text);
    return;
  }
  collectTextPayload(raw.content, parts);
}

function stripSingleCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return match ? match[1] : text;
}

function extractTextOutput(
  content: ReadonlyArray<ToolCallContent> | null | undefined
): string | undefined {
  if (!content) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    const raw = block as { type?: unknown; content?: unknown; text?: unknown };
    if (raw.type === 'content') {
      collectTextPayload(raw.content, parts);
    } else if (raw.type === 'text' && typeof raw.text === 'string') {
      parts.push(raw.text);
    }
  }
  const text = parts.join('\n');
  return text ? stripSingleCodeFence(text) : undefined;
}

function extractTerminalId(update: SessionUpdate): string | undefined {
  const raw = update as unknown as { terminalId?: unknown; terminal_id?: unknown };
  if (typeof raw.terminalId === 'string') return raw.terminalId;
  if (typeof raw.terminal_id === 'string') return raw.terminal_id;
  return undefined;
}

function extractInputSummary(update: SessionUpdate): string | undefined {
  const raw = update as unknown as {
    inputSummary?: unknown;
    input_summary?: unknown;
    description?: unknown;
  };
  if (typeof raw.inputSummary === 'string') return raw.inputSummary;
  if (typeof raw.input_summary === 'string') return raw.input_summary;
  if (typeof raw.description === 'string') return raw.description;
  return undefined;
}

/**
 * Decode a raw ACP SessionUpdate into a NormalizedEvent.
 * Stateless — does not depend on turn or session context.
 */
export function decodeSessionUpdate(update: SessionUpdate): NormalizedEvent {
  switch (update.sessionUpdate) {
    case 'user_message_chunk': {
      if (update.content.type !== 'text' || !update.content.text) return { kind: 'ignored' };
      return {
        kind: 'message',
        role: 'user',
        messageId: update.messageId ?? null,
        text: update.content.text,
      };
    }

    case 'agent_message_chunk': {
      if (update.content.type !== 'text' || !update.content.text) return { kind: 'ignored' };
      return {
        kind: 'message',
        role: 'assistant',
        messageId: update.messageId ?? null,
        text: update.content.text,
      };
    }

    case 'agent_thought_chunk': {
      if (update.content.type !== 'text' || !update.content.text) return { kind: 'ignored' };
      return {
        kind: 'thinking',
        messageId: update.messageId ?? null,
        text: update.content.text,
      };
    }

    case 'tool_call': {
      const terminalId = extractTerminalId(update);
      const inputSummary = extractInputSummary(update);
      return {
        kind: 'tool_call',
        toolCallId: update.toolCallId,
        title: update.title,
        toolKind: update.kind ?? null,
        status: (update.status as NormalizedToolStatus | undefined) ?? null,
        parentToolCallId: null,
        diffs: extractDiffs(update.content),
        ...(inputSummary !== undefined ? { inputSummary } : {}),
        ...(terminalId !== undefined ? { terminalId } : {}),
      };
    }

    case 'tool_call_update': {
      const outputText = extractTextOutput(update.content ?? undefined);
      const terminalId = extractTerminalId(update);
      return {
        kind: 'tool_update',
        toolCallId: update.toolCallId,
        title: update.title ?? null,
        toolKind: update.kind ?? null,
        status: (update.status as NormalizedToolStatus | undefined | null) ?? null,
        parentToolCallId: null,
        diffs: extractDiffs(update.content ?? undefined),
        ...(outputText !== undefined ? { outputText } : {}),
        ...(terminalId !== undefined ? { terminalId } : {}),
      };
    }

    case 'plan': {
      return {
        kind: 'plan',
        entries: update.entries.map((e) => ({
          content: e.content,
          status: e.status,
          priority: e.priority,
        })),
      };
    }

    case 'config_option_update': {
      const raw = update as unknown as { configOptions?: unknown };
      const options = Array.isArray(raw.configOptions) ? raw.configOptions : [];
      return { kind: 'config', options };
    }

    case 'current_mode_update': {
      const raw = update as unknown as { currentModeId?: string };
      if (!raw.currentModeId) return { kind: 'ignored' };
      return { kind: 'mode_selected', modeId: raw.currentModeId };
    }

    case 'available_commands_update': {
      const raw = update as unknown as { availableCommands?: unknown };
      const commands = Array.isArray(raw.availableCommands) ? raw.availableCommands : [];
      return { kind: 'commands', commands };
    }

    case 'usage_update': {
      const raw = update as unknown as {
        used?: number;
        size?: number;
        cost?: { amount?: number; currency?: string } | null;
      };
      const contextUsed = raw.used ?? 0;
      const contextSize = raw.size ?? 0;
      const cost =
        raw.cost && typeof raw.cost.amount === 'number' && raw.cost.currency
          ? { amount: raw.cost.amount, currency: raw.cost.currency }
          : null;
      return { kind: 'usage', usage: { contextUsed, contextSize, cost } };
    }

    case 'session_info_update': {
      const raw = update as unknown as { title?: string };
      if (!raw.title) return { kind: 'ignored' };
      return { kind: 'title', title: raw.title };
    }

    // plan_update and plan_removed are UNSTABLE/ID-based ACP variants gated
    // behind PlanCapabilities — not emitted by Claude. Ignored for now.
    default:
      return { kind: 'ignored' };
  }
}
