/**
 * Item-level fold: NormalizedEvent -> TranscriptItem[].
 *
 * foldItem applies one NormalizedEvent to an existing item list and returns
 * the updated list. The fold materializes streaming ACP updates into concrete
 * turn-owned models: messages, thinking segments, tool-call items, and
 * deterministic tool groups.
 *
 * finalizeItems settles all in-progress states for a turn that has just been
 * committed (thinking done + durationMs, running tool/group -> done).
 *
 * Both functions are pure and allocation-efficient: only changed items are
 * replaced; unchanged items are returned by reference.
 */

import { SESSION_PLAN_ID } from '../models/plan';
import type {
  CreateFileToolCall,
  CreatePlanToolCall,
  ModifyFileToolCall,
  TranscriptItem,
  TranscriptMessage,
  TranscriptThinking,
  ToolCallItem,
  ToolGroup,
  ToolNode,
  ToolStatus,
} from '../models/turns';
import {
  makeDiffId,
  makeMessageId,
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

function isToolCallItem(item: TranscriptItem): item is ToolCallItem {
  return item.kind.endsWith('-tool-call');
}

function isToolGroup(item: TranscriptItem): item is ToolGroup {
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

function compareSeq(a: { seq: number }, b: { seq: number }): number {
  return a.seq - b.seq;
}

function stripChildren<T extends ToolCallItem>(item: T): T {
  if (!item.children?.length) return item;
  const { children: _children, ...withoutChildren } = item;
  return withoutChildren as T;
}

function flattenItems(items: TranscriptItem[]): TranscriptItem[] {
  const flat: TranscriptItem[] = [];
  const visit = (item: TranscriptItem | ToolNode): void => {
    if (isToolGroup(item)) {
      for (const child of item.children) visit(child);
      return;
    }
    if (isToolCallItem(item)) {
      flat.push(stripChildren(item));
      for (const child of item.children ?? []) visit(child);
      return;
    }
    flat.push(item);
  };
  for (const item of items) visit(item);
  return flat.sort(compareSeq);
}

function maxSeq(items: TranscriptItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.seq), -1);
}

function nextSeq(items: TranscriptItem[]): number {
  return maxSeq(items) + 1;
}

function baseToolFields(
  id: string,
  seq: number,
  toolCallId: string,
  title: string,
  status: NormalizedToolStatus | null,
  parentToolCallId: string | undefined,
  inputSummary?: string
): Omit<ToolCallItem, 'kind'> {
  return {
    id,
    seq,
    toolCallId,
    title,
    status: mapToolStatus(status) ?? 'running',
    ...(inputSummary !== undefined ? { inputSummary } : {}),
    ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
  };
}

export function createToolCallItem(params: {
  id: string;
  seq: number;
  toolCallId: string;
  title: string;
  toolKind: string | null;
  status: NormalizedToolStatus | null;
  parentToolCallId: string | undefined;
  inputSummary?: string;
}): ToolCallItem {
  const base = baseToolFields(
    params.id,
    params.seq,
    params.toolCallId,
    params.title,
    params.status,
    params.parentToolCallId,
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
    return {
      kind: 'read-tool-call',
      ...base,
      ...(inferReadPath(title) ? { path: inferReadPath(title) } : {}),
    };
  }
  if (isExecuteKind(toolKind)) {
    return { kind: 'execute-tool-call', ...base, command: title };
  }
  return { kind: 'unknown-tool-call', ...base, toolKind, name: title };
}

function updateToolCallItem(
  item: ToolCallItem,
  title: string | null,
  status: NormalizedToolStatus | null
): ToolCallItem {
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

function upsertToolCallItem(items: TranscriptItem[], next: ToolCallItem): TranscriptItem[] {
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
  const existing = items.find(
    (item): item is ToolCallItem => isToolCallItem(item) && item.id === id
  );
  const seq = existing?.seq ?? nextSeq(items);
  const parentToolCallId = event.parentToolCallId ?? undefined;
  const mapped = mapToolStatus(event.status) ?? 'running';

  let next: ToolCallItem;
  switch (event.kind) {
    case 'subagent':
      next = {
        kind: 'spawn-subagent-tool-call',
        id,
        seq,
        toolCallId: event.toolCallId,
        title: event.title,
        name: event.title,
        status: mapped,
        ...(event.inputSummary !== undefined ? { inputSummary: event.inputSummary } : {}),
        ...(event.background !== undefined ? { background: event.background } : {}),
        ...(event.agentId !== undefined ? { agentId: event.agentId } : {}),
        ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
      };
      break;
    case 'search':
      next = {
        kind: 'search-tool-call',
        id,
        seq,
        toolCallId: event.toolCallId,
        title: event.query,
        query: event.query,
        status: mapped,
        ...(event.matchCount !== undefined ? { matchCount: event.matchCount } : {}),
        ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
      };
      break;
    case 'mcp_tool':
      next = {
        kind: 'mcp-tool-call',
        id,
        seq,
        toolCallId: event.toolCallId,
        title: event.tool,
        tool: event.tool,
        status: mapped,
        ...(event.server !== undefined ? { server: event.server } : {}),
        ...(event.inputSummary !== undefined ? { inputSummary: event.inputSummary } : {}),
        ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
      };
      break;
    case 'web_fetch':
      next = {
        kind: 'web-fetch-tool-call',
        id,
        seq,
        toolCallId: event.toolCallId,
        title: event.title ?? event.url,
        url: event.url,
        status: mapped,
        ...(event.title !== undefined ? { pageTitle: event.title } : {}),
        ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
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
  parentToolCallId: string | undefined,
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
      seq: nextSeq(result),
      toolCallId,
      title,
      path: d.path,
      status: mapped ?? 'running',
      ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
    };
    if (idx >= 0) {
      const existing = result[idx] as ToolCallItem;
      const updated: ToolCallItem =
        d.oldText === null
          ? ({
              ...existing,
              kind: 'create-file-tool-call',
              content: d.newText,
              path: d.path,
              title,
              toolCallId,
              ...(mapped !== undefined ? { status: mapped } : {}),
              ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
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
              ...(parentToolCallId !== undefined ? { parentToolCallId } : {}),
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
    seq: idx >= 0 ? items[idx].seq : nextSeq(items),
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

function nodeStatus(node: ToolNode): ToolStatus {
  return node.status;
}

function readGroupStatus(children: ToolNode[]): ToolStatus {
  if (children.some((child) => nodeStatus(child) === 'running')) return 'running';
  if (children.some((child) => nodeStatus(child) === 'error')) return 'error';
  return 'done';
}

function wrapReadGroups<T extends TranscriptItem | ToolNode>(items: T[]): Array<T | ToolGroup> {
  const result: Array<T | ToolGroup> = [];
  for (let i = 0; i < items.length; ) {
    const item = items[i];
    if (item.kind !== 'read-tool-call') {
      result.push(item);
      i += 1;
      continue;
    }

    const run: ToolNode[] = [item];
    let j = i + 1;
    while (j < items.length && items[j].kind === 'read-tool-call') {
      run.push(items[j] as ToolNode);
      j += 1;
    }

    if (run.length > 1) {
      result.push({
        kind: 'tool-group',
        id: makeToolGroupId(run[0].id),
        seq: run[0].seq,
        label: `${run.length} file reads`,
        groupKind: 'read-batch',
        status: readGroupStatus(run),
        children: run,
      });
    } else {
      result.push(item);
    }
    i = j;
  }
  return result;
}

function buildTree(flatItems: TranscriptItem[], turnId: string): TranscriptItem[] {
  const toolById = new Map<string, ToolCallItem>();
  const childrenByParent = new Map<string, ToolCallItem[]>();
  const topLevel: TranscriptItem[] = [];

  for (const item of flatItems) {
    if (isToolCallItem(item)) {
      toolById.set(item.id, stripChildren(item));
    }
  }

  for (const item of flatItems) {
    if (!isToolCallItem(item)) {
      topLevel.push(item);
      continue;
    }

    const parentItemId =
      item.parentToolCallId !== undefined ? makeToolId(turnId, item.parentToolCallId) : undefined;
    if (parentItemId !== undefined && toolById.has(parentItemId)) {
      const children = childrenByParent.get(parentItemId) ?? [];
      children.push(stripChildren(item));
      childrenByParent.set(parentItemId, children);
    } else {
      topLevel.push(stripChildren(item));
    }
  }

  const attachChildren = (item: ToolCallItem): ToolCallItem => {
    const rawChildren = childrenByParent.get(item.id);
    if (!rawChildren?.length) return stripChildren(item);

    const children = wrapReadGroups(rawChildren.map(attachChildren).sort(compareSeq)) as ToolNode[];
    return { ...stripChildren(item), children };
  };

  const attached = topLevel.map(
    (item): TranscriptItem => (isToolCallItem(item) ? attachChildren(item) : item)
  );

  return wrapReadGroups(attached.sort(compareSeq)) as TranscriptItem[];
}

function normalizeToolStructure(items: TranscriptItem[], turnId: string): TranscriptItem[] {
  return buildTree(flattenItems(items), turnId);
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
  const flatItems = flattenItems(items);
  switch (event.kind) {
    case 'message': {
      const id = makeMessageId(turnId, event.messageId, event.role);
      const base = finalizeOpenThinking(flatItems, at);
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
        return normalizeToolStructure(
          base.map((it, i) => (i === idx ? updated : it)),
          turnId
        );
      }
      // New message.
      const newMsg: TranscriptMessage = {
        kind: 'message',
        id,
        seq: nextSeq(base),
        role: event.role,
        text: event.text,
        ...(event.attachments?.length ? { attachments: event.attachments } : {}),
      };
      return normalizeToolStructure([...base, newMsg], turnId);
    }

    case 'thinking': {
      const id = makeThinkingId(turnId, event.messageId);
      const idx = flatItems.findIndex(
        (it) => it.kind === 'thinking' && it.id === id && it.status === 'thinking'
      );
      if (idx >= 0) {
        const th = flatItems[idx] as TranscriptThinking;
        return normalizeToolStructure(
          flatItems.map((it, i) => (i === idx ? { ...th, text: th.text + event.text } : it)),
          turnId
        );
      }
      const newThinking: TranscriptThinking = {
        kind: 'thinking',
        id,
        seq: nextSeq(flatItems),
        segmentId: event.messageId,
        text: event.text,
        status: 'thinking',
        startedAt: at,
      };
      return normalizeToolStructure([...finalizeOpenThinking(flatItems, at), newThinking], turnId);
    }

    case 'tool_call': {
      const toolId = makeToolId(turnId, event.toolCallId);
      const parentToolCallId = event.parentToolCallId ?? undefined;
      const base = finalizeOpenThinking(flatItems, at);
      if (event.diffs.length > 0) {
        const next = upsertFileOperations(
          base,
          toolId,
          event.toolCallId,
          event.title,
          parentToolCallId,
          event.diffs,
          event.status
        );
        return normalizeToolStructure(next, turnId);
      }

      if (isEditKind(event.toolKind)) return normalizeToolStructure(base, turnId);

      const tool = createToolCallItem({
        id: toolId,
        seq: nextSeq(base),
        toolCallId: event.toolCallId,
        title: event.title,
        toolKind: event.toolKind,
        status: event.status,
        parentToolCallId,
      });
      const next = upsertToolCallItem(base, tool);
      return normalizeToolStructure(next, turnId);
    }

    case 'tool_update': {
      const toolId = makeToolId(turnId, event.toolCallId);
      const parentToolCallId = event.parentToolCallId ?? undefined;
      const base = finalizeOpenThinking(flatItems, at);
      if (event.diffs.length > 0) {
        const next = upsertFileOperations(
          base,
          toolId,
          event.toolCallId,
          event.title ?? 'Edit file',
          parentToolCallId,
          event.diffs,
          event.status
        );
        return normalizeToolStructure(next, turnId);
      }

      const idx = base.findIndex((it) => isToolCallItem(it) && it.id === toolId);
      let next: TranscriptItem[];
      if (idx >= 0) {
        const tool = base[idx] as ToolCallItem;
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
            seq: nextSeq(base),
            toolCallId: event.toolCallId,
            title: event.title ?? 'unknown',
            toolKind: event.toolKind,
            status: event.status,
            parentToolCallId,
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
      const base = finalizeOpenThinking(flatItems, at);
      return upsertSpecialEvent(base, event, turnId);
    }

    case 'plan': {
      const base = finalizeOpenThinking(flatItems, at);
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
 * Settle all in-progress states for a committed turn.
 *
 * - thinking status 'thinking' → 'done' + computed durationMs
 * - tool status 'running' → 'done'
 *
 * Input must be plain objects (not Solid/MobX proxies).
 */
export function finalizeItems(items: TranscriptItem[], at: number): TranscriptItem[] {
  const finalizeNode = (item: ToolNode): ToolNode => {
    if (isToolGroup(item)) {
      const children = item.children.map(finalizeNode);
      return { ...item, children, status: readGroupStatus(children) };
    }

    const children = item.children?.map(finalizeNode);
    const status = item.status === 'running' ? 'done' : item.status;
    return {
      ...item,
      status,
      ...(children?.length ? { children } : {}),
    } as ToolNode;
  };

  return items.map((item): TranscriptItem => {
    switch (item.kind) {
      case 'message':
        return item;
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
        return finalizeNode(item) as TranscriptItem;
    }
  });
}
