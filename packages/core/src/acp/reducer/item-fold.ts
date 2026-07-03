/**
 * Item-level fold: NormalizedEvent -> TranscriptItem[].
 *
 * foldItem applies one NormalizedEvent to an existing item list and returns
 * the updated list. The fold materializes streaming ACP updates into concrete
 * turn-owned models: messages, thinking segments, tool-call items, and
 * deterministic tool groups.
 *
 * finalizeItems settles all in-progress streaming states for a turn that has
 * just been committed (message.streaming -> false, thinking done + durationMs,
 * running tool/group -> done).
 *
 * Both functions are pure and allocation-efficient: only changed items are
 * replaced; unchanged items are returned by reference.
 */

import type {
  CreateFileToolCall,
  CreatePlanToolCall,
  ModifyFileToolCall,
  TranscriptItem,
  TranscriptMessage,
  TranscriptThinking,
  TranscriptToolCallItem,
  TranscriptToolGroupSnapshot,
  ToolStatus,
} from '../models/turns';
import { SESSION_PLAN_ID } from '../models/plan';
import {
  makeDiffId,
  makeMessageId,
  makeParentId,
  makePlanId,
  makeThinkingId,
  makeToolGroupId,
  makeToolId,
} from './ids';
import type { NormalizedDiff, NormalizedEvent, NormalizedToolStatus } from './normalized-event';

export type FoldEvent =
  | Exclude<NormalizedEvent, { kind: 'message' | 'thinking' }>
  | (Extract<NormalizedEvent, { kind: 'message' }> & { messageId: string })
  | (Extract<NormalizedEvent, { kind: 'thinking' }> & { messageId: string });

function mapToolStatus(status: NormalizedToolStatus | null | undefined): ToolStatus | undefined {
  switch (status) {
    case 'pending':
    case 'in_progress':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'error';
    default:
      return undefined;
  }
}

function isToolCallItem(item: TranscriptItem): item is TranscriptToolCallItem {
  return item.kind.endsWith('-tool-call');
}

function isToolGroup(item: TranscriptItem): item is TranscriptToolGroupSnapshot {
  return item.kind === 'tool-group';
}

function isSubagentKind(toolKind: string | null | undefined): boolean {
  return toolKind === 'subagent' || toolKind === 'task' || toolKind === 'agent';
}

function isSearchKind(toolKind: string | null | undefined): boolean {
  return toolKind === 'search' || toolKind === 'grep';
}

function isReadKind(toolKind: string | null | undefined, title?: string | null): boolean {
  return toolKind === 'read' || toolKind === 'read_file' || title?.startsWith('Read ') === true;
}

function isEditKind(toolKind: string | null | undefined): boolean {
  return toolKind === 'edit' || toolKind === 'write' || toolKind === 'apply_patch';
}

function isExecuteKind(toolKind: string | null | undefined): boolean {
  return toolKind === 'execute' || toolKind === 'terminal' || toolKind === 'bash';
}

function isMcpToolKind(toolKind: string | null | undefined): boolean {
  return toolKind === 'mcp-tool' || toolKind === 'mcp_tool';
}

function isWebFetchKind(toolKind: string | null | undefined): boolean {
  return toolKind === 'web-fetch' || toolKind === 'web_fetch' || toolKind === 'fetch';
}

function inferReadPath(title: string): string | undefined {
  const match = /^Read\s+(.+?)(?:\s+\(|$)/.exec(title);
  return match?.[1];
}

function baseToolFields(
  id: string,
  toolCallId: string,
  title: string,
  status: NormalizedToolStatus | null,
  parentId: string | undefined,
  inputSummary?: string
): Omit<TranscriptToolCallItem, 'kind'> {
  return {
    id,
    toolCallId,
    title,
    status: mapToolStatus(status) ?? 'running',
    ...(inputSummary !== undefined ? { inputSummary } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
  };
}

export function createToolCallItem(params: {
  id: string;
  toolCallId: string;
  title: string;
  toolKind: string | null;
  status: NormalizedToolStatus | null;
  parentId: string | undefined;
  inputSummary?: string;
}): TranscriptToolCallItem {
  const base = baseToolFields(
    params.id,
    params.toolCallId,
    params.title,
    params.status,
    params.parentId,
    params.inputSummary
  );
  const { title, toolKind } = params;
  if (isSubagentKind(toolKind)) {
    return { kind: 'spawn-subagent-tool-call', ...base, name: title };
  }
  if (isSearchKind(toolKind)) {
    return { kind: 'search-tool-call', ...base, query: title };
  }
  if (isMcpToolKind(toolKind)) {
    return { kind: 'mcp-tool-call', ...base, tool: title };
  }
  if (isWebFetchKind(toolKind)) {
    return { kind: 'web-fetch-tool-call', ...base, url: title };
  }
  if (isReadKind(toolKind, title)) {
    return { kind: 'read-tool-call', ...base, ...(inferReadPath(title) ? { path: inferReadPath(title) } : {}) };
  }
  if (isExecuteKind(toolKind)) {
    return { kind: 'execute-tool-call', ...base, command: title };
  }
  return { kind: 'unknown-tool-call', ...base, toolKind, name: title };
}

function updateToolCallItem(
  item: TranscriptToolCallItem,
  title: string | null,
  status: NormalizedToolStatus | null
): TranscriptToolCallItem {
  const mapped = mapToolStatus(status ?? undefined);
  const nextTitle = title ?? item.title;
  const common = {
    ...item,
    ...(mapped !== undefined ? { status: mapped } : {}),
    ...(title !== null ? { title: title } : {}),
  };
  switch (item.kind) {
    case 'execute-tool-call':
      return { ...common, ...(title !== null ? { command: nextTitle } : {}) };
    case 'read-tool-call':
      return {
        ...common,
        ...(title !== null && inferReadPath(nextTitle) ? { path: inferReadPath(nextTitle) } : {}),
      };
    case 'create-file-tool-call':
      return common;
    case 'modify-file-tool-call':
      return common;
    case 'delete-file-tool-call':
      return common;
    case 'search-tool-call':
      return { ...common, ...(title !== null ? { query: nextTitle } : {}) };
    case 'mcp-tool-call':
      return { ...common, ...(title !== null ? { tool: nextTitle } : {}) };
    case 'web-fetch-tool-call':
      return { ...common, ...(title !== null ? { pageTitle: nextTitle } : {}) };
    case 'spawn-subagent-tool-call':
      return { ...common, ...(title !== null ? { name: nextTitle } : {}) };
    case 'create-plan-tool-call':
      return common;
    case 'unknown-tool-call':
      return { ...common, ...(title !== null ? { name: nextTitle } : {}) };
  }
}

function upsertToolCallItem(items: TranscriptItem[], next: TranscriptToolCallItem): TranscriptItem[] {
  const idx = items.findIndex((item) => isToolCallItem(item) && item.id === next.id);
  if (idx >= 0) return items.map((item, i) => (i === idx ? next : item));
  return [...items, next];
}

function upsertSpecialEvent(
  items: TranscriptItem[],
  event: Extract<NormalizedEvent, { kind: 'subagent' | 'search' | 'mcp_tool' | 'web_fetch' }>,
  turnId: string
): TranscriptItem[] {
  const id = makeToolId(turnId, event.toolCallId);
  const parentId = makeParentId(turnId, event.parentToolCallId);
  const mapped = mapToolStatus(event.status) ?? 'running';

  let next: TranscriptToolCallItem;
  switch (event.kind) {
    case 'subagent':
      next = {
        kind: 'spawn-subagent-tool-call',
        id,
        toolCallId: event.toolCallId,
        title: event.title,
        name: event.title,
        status: mapped,
        ...(event.inputSummary !== undefined ? { inputSummary: event.inputSummary } : {}),
        ...(event.background !== undefined ? { background: event.background } : {}),
        ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
      };
      break;
    case 'search':
      next = {
        kind: 'search-tool-call',
        id,
        toolCallId: event.toolCallId,
        title: event.query,
        query: event.query,
        status: mapped,
        ...(event.matchCount !== undefined ? { matchCount: event.matchCount } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
      };
      break;
    case 'mcp_tool':
      next = {
        kind: 'mcp-tool-call',
        id,
        toolCallId: event.toolCallId,
        title: event.tool,
        tool: event.tool,
        status: mapped,
        ...(event.server !== undefined ? { server: event.server } : {}),
        ...(event.inputSummary !== undefined ? { inputSummary: event.inputSummary } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
      };
      break;
    case 'web_fetch':
      next = {
        kind: 'web-fetch-tool-call',
        id,
        toolCallId: event.toolCallId,
        title: event.title ?? event.url,
        url: event.url,
        status: mapped,
        ...(event.title !== undefined ? { pageTitle: event.title } : {}),
        ...(parentId !== undefined ? { parentId } : {}),
      };
      break;
  }

  return normalizeToolStructure(upsertToolCallItem(items, next), turnId);
}

/**
 * Auto-finalize any open thinking rows when a non-thinking content event
 * arrives. Mirrors the renderer's applyFinalizeOpenThinking behavior.
 */
function finalizeOpenThinking(items: TranscriptItem[], now: number): TranscriptItem[] {
  let changed = false;
  const result = items.map((item) => {
    if (item.kind === 'thinking' && item.status === 'thinking') {
      changed = true;
      return {
        ...item,
        status: 'done' as const,
        durationMs: now - item.startedAt,
      } satisfies TranscriptThinking;
    }
    return item;
  });
  return changed ? result : items;
}

function upsertFileOperations(
  items: TranscriptItem[],
  toolId: string,
  toolCallId: string,
  title: string,
  parentId: string | undefined,
  diffs: NormalizedDiff[],
  status: NormalizedToolStatus | null
): TranscriptItem[] {
  let result = items;
  for (const d of diffs) {
    const id = makeDiffId(toolId, d.path);
    const mapped = mapToolStatus(status);
    const idx = result.findIndex((it) => isToolCallItem(it) && it.id === id);
    const base = {
      id,
      toolCallId,
      title,
      path: d.path,
      status: mapped ?? 'running',
      ...(parentId !== undefined ? { parentId } : {}),
    };
    if (idx >= 0) {
      const existing = result[idx] as TranscriptToolCallItem;
      const updated: TranscriptToolCallItem =
        d.oldText === null
          ? ({
              ...existing,
              kind: 'create-file-tool-call',
              content: d.newText,
              path: d.path,
              title,
              toolCallId,
              ...(mapped !== undefined ? { status: mapped } : {}),
              ...(parentId !== undefined ? { parentId } : {}),
            } satisfies CreateFileToolCall)
          : ({
              ...existing,
              kind: 'modify-file-tool-call',
              oldText: d.oldText,
              newText: d.newText,
              path: d.path,
              title,
              toolCallId,
              ...(mapped !== undefined ? { status: mapped } : {}),
              ...(parentId !== undefined ? { parentId } : {}),
            } satisfies ModifyFileToolCall);
      result = result.map((it, i) => (i === idx ? updated : it));
    } else if (d.oldText === null) {
      result = [
        ...result,
        {
          kind: 'create-file-tool-call',
          ...base,
          content: d.newText,
        } satisfies CreateFileToolCall,
      ];
    } else {
      result = [
        ...result,
        {
          kind: 'modify-file-tool-call',
          ...base,
          oldText: d.oldText,
          newText: d.newText,
        } satisfies ModifyFileToolCall,
      ];
    }
  }
  return result;
}

function updateFileOperationStatuses(
  items: TranscriptItem[],
  toolCallId: string,
  status: NormalizedToolStatus | null
): TranscriptItem[] {
  const mapped = mapToolStatus(status);
  if (mapped === undefined) return items;
  return items.map((item): TranscriptItem => {
    switch (item.kind) {
      case 'create-file-tool-call':
      case 'modify-file-tool-call':
      case 'delete-file-tool-call':
        return item.toolCallId === toolCallId ? { ...item, status: mapped } : item;
      default:
        return item;
    }
  });
}

function hasFileOperationsForToolCall(items: TranscriptItem[], toolCallId: string): boolean {
  return items.some((item) => {
    switch (item.kind) {
      case 'create-file-tool-call':
      case 'modify-file-tool-call':
      case 'delete-file-tool-call':
        return item.toolCallId === toolCallId;
      default:
        return false;
    }
  });
}

function planStatus(entries: Extract<NormalizedEvent, { kind: 'plan' }>['entries']): ToolStatus {
  return entries.some((entry) => entry.status === 'in_progress') ? 'running' : 'done';
}

function upsertPlanToolCall(
  items: TranscriptItem[],
  turnId: string,
  event: Extract<NormalizedEvent, { kind: 'plan' }>
): TranscriptItem[] {
  const id = makePlanId(turnId);
  const idx = items.findIndex((it) => it.kind === 'create-plan-tool-call' && it.id === id);
  const next: CreatePlanToolCall = {
    kind: 'create-plan-tool-call',
    id,
    toolCallId: id,
    title: 'Plan updated',
    status: planStatus(event.entries),
    planId: SESSION_PLAN_ID,
  };
  if (idx >= 0) {
    const existing = items[idx] as CreatePlanToolCall;
    return items.map((item, i) =>
      i === idx
        ? {
            ...existing,
            status: next.status,
            title: next.title,
            planId: next.planId,
          }
        : item
    );
  }
  return [...items, next];
}

function readGroupStatus(children: TranscriptToolCallItem[]): ToolStatus {
  if (children.some((child) => child.status === 'running')) return 'running';
  if (children.some((child) => child.status === 'error')) return 'error';
  return 'done';
}

function rebuildReadGroups(items: TranscriptItem[], turnId: string): TranscriptItem[] {
  const source = items.filter((item) => !(isToolGroup(item) && item.groupKind === 'read-batch'));
  const result: TranscriptItem[] = [];
  let groupIndex = 0;
  for (let i = 0; i < source.length; ) {
    const item = source[i];
    if (item.kind !== 'read-tool-call') {
      result.push(item);
      i += 1;
      continue;
    }

    const run: TranscriptToolCallItem[] = [item];
    let j = i + 1;
    while (j < source.length && source[j].kind === 'read-tool-call') {
      run.push(source[j] as TranscriptToolCallItem);
      j += 1;
    }

    if (run.length > 1) {
      result.push({
        kind: 'tool-group',
        id: makeToolGroupId(turnId, 'read-batch', groupIndex),
        label: `${run.length} file reads`,
        groupKind: 'read-batch',
        childIds: run.map((child) => child.id),
        status: readGroupStatus(run),
        ...(run[0].parentId !== undefined ? { parentId: run[0].parentId } : {}),
      });
      groupIndex += 1;
    }
    result.push(...run);
    i = j;
  }
  return result;
}

function applyHierarchicalChildren(items: TranscriptItem[]): TranscriptItem[] {
  const childrenByParent = new Map<string, string[]>();
  for (const item of items) {
    if ('parentId' in item && item.parentId !== undefined) {
      const children = childrenByParent.get(item.parentId) ?? [];
      children.push(item.id);
      childrenByParent.set(item.parentId, children);
    }
  }
  return items.map((item): TranscriptItem => {
    if (!isToolCallItem(item)) return item;
    const childIds = childrenByParent.get(item.id);
    if (!childIds?.length) {
      if (!item.childIds?.length) return item;
      const { childIds: _childIds, ...withoutChildIds } = item;
      return withoutChildIds as TranscriptItem;
    }
    if (item.childIds?.join('\0') === childIds.join('\0')) return item;
    return { ...item, childIds };
  });
}

function normalizeToolStructure(items: TranscriptItem[], turnId: string): TranscriptItem[] {
  return applyHierarchicalChildren(rebuildReadGroups(items, turnId));
}

/**
 * Apply one NormalizedEvent to a turn's item list, returning an updated list.
 * The turnId is used for id synthesis — all item ids are scoped to the turn.
 *
 * Content-bearing events (message, tool, diff, plan) auto-finalize any open
 * thinking rows before appending (the agent has moved past the reasoning phase).
 */
export function foldItem(
  items: TranscriptItem[],
  event: FoldEvent,
  turnId: string,
  at: number
): TranscriptItem[] {
  switch (event.kind) {
    case 'message': {
      const id = makeMessageId(turnId, event.messageId, event.role);
      const base = finalizeOpenThinking(items, at);
      const idx = base.findIndex((it) => it.kind === 'message' && it.id === id);
      if (idx >= 0) {
        // Append chunk to existing message.
        const msg = base[idx] as TranscriptMessage;
        const updated: TranscriptMessage = {
          ...msg,
          text: msg.text + event.text,
          ...(event.attachments?.length
            ? { attachments: [...(msg.attachments ?? []), ...event.attachments] }
            : {}),
        };
        return base.map((it, i) => (i === idx ? updated : it));
      }
      // New message.
      const newMsg: TranscriptMessage = {
        kind: 'message',
        id,
        role: event.role,
        text: event.text,
        streaming: true,
        ...(event.attachments?.length ? { attachments: event.attachments } : {}),
      };
      return [...base, newMsg];
    }

    case 'thinking': {
      const id = makeThinkingId(turnId, event.messageId);
      const idx = items.findIndex(
        (it) => it.kind === 'thinking' && it.id === id && it.status === 'thinking'
      );
      if (idx >= 0) {
        const th = items[idx] as TranscriptThinking;
        return items.map((it, i) => (i === idx ? { ...th, text: th.text + event.text } : it));
      }
      const newThinking: TranscriptThinking = {
        kind: 'thinking',
        id,
        segmentId: event.messageId,
        text: event.text,
        status: 'thinking',
        startedAt: at,
      };
      return [...finalizeOpenThinking(items, at), newThinking];
    }

    case 'tool_call': {
      const toolId = makeToolId(turnId, event.toolCallId);
      const parentId = makeParentId(turnId, event.parentToolCallId);
      const base = finalizeOpenThinking(items, at);
      if (event.diffs.length > 0) {
        const next = upsertFileOperations(
          base,
          toolId,
          event.toolCallId,
          event.title,
          parentId,
          event.diffs,
          event.status
        );
        return normalizeToolStructure(next, turnId);
      }

      if (isEditKind(event.toolKind)) return base;

      const tool = createToolCallItem({
        id: toolId,
        toolCallId: event.toolCallId,
        title: event.title,
        toolKind: event.toolKind,
        status: event.status,
        parentId,
      });
      const next = upsertToolCallItem(base, tool);
      return normalizeToolStructure(next, turnId);
    }

    case 'tool_update': {
      const toolId = makeToolId(turnId, event.toolCallId);
      const parentId = makeParentId(turnId, event.parentToolCallId);
      const base = finalizeOpenThinking(items, at);
      if (event.diffs.length > 0) {
        const next = upsertFileOperations(
          base,
          toolId,
          event.toolCallId,
          event.title ?? 'Edit file',
          parentId,
          event.diffs,
          event.status
        );
        return normalizeToolStructure(next, turnId);
      }

      const idx = base.findIndex((it) => isToolCallItem(it) && it.id === toolId);
      let next: TranscriptItem[];
      if (idx >= 0) {
        const tool = base[idx] as TranscriptToolCallItem;
        const updated = updateToolCallItem(tool, event.title, event.status);
        next = base.map((it, i) => (i === idx ? updated : it));
      } else if (hasFileOperationsForToolCall(base, event.toolCallId)) {
        next = base;
      } else if (isEditKind(event.toolKind)) {
        next = base;
      } else {
        next = upsertToolCallItem(
          base,
          createToolCallItem({
            id: toolId,
            toolCallId: event.toolCallId,
            title: event.title ?? 'unknown',
            toolKind: event.toolKind,
            status: event.status,
            parentId,
          })
        );
      }

      next = updateFileOperationStatuses(next, event.toolCallId, event.status);
      return normalizeToolStructure(next, turnId);
    }

    case 'subagent':
    case 'search':
    case 'mcp_tool':
    case 'web_fetch': {
      const base = finalizeOpenThinking(items, at);
      return upsertSpecialEvent(base, event, turnId);
    }

    case 'plan': {
      const base = finalizeOpenThinking(items, at);
      return normalizeToolStructure(upsertPlanToolCall(base, turnId, event), turnId);
    }

    case 'ignored':
    // Session-config / meta variants never reach foldItem (router intercepts them),
    // but the extended NormalizedEvent union requires a total switch.
    default:
      return items;
  }
}

/**
 * Settle all in-progress streaming states for a committed turn.
 *
 * - message.streaming → false
 * - thinking status 'thinking' → 'done' + computed durationMs
 * - tool status 'running' → 'done'
 *
 * Input must be plain objects (not Solid/MobX proxies).
 */
export function finalizeItems(items: TranscriptItem[], at: number): TranscriptItem[] {
  return items.map((item): TranscriptItem => {
    switch (item.kind) {
      case 'message':
        return item.streaming ? { ...item, streaming: false } : item;
      case 'thinking':
        return item.status === 'thinking'
          ? { ...item, status: 'done' as const, durationMs: at - item.startedAt }
          : item;
      case 'execute-tool-call':
      case 'read-tool-call':
      case 'create-file-tool-call':
      case 'modify-file-tool-call':
      case 'delete-file-tool-call':
      case 'search-tool-call':
      case 'mcp-tool-call':
      case 'web-fetch-tool-call':
      case 'spawn-subagent-tool-call':
      case 'create-plan-tool-call':
      case 'unknown-tool-call':
      case 'tool-group':
        return item.status === 'running' ? { ...item, status: 'done' as const } : item;
    }
  });
}
