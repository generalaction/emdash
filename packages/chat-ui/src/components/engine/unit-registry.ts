/**
 * unit-registry — segmenter and unit-def registries for the flat unit engine.
 *
 * Two independent maps:
 *
 *   SEGMENTERS   — ChatItem.kind → ItemSegmenter
 *                  Defines how each transcript item is split into RenderUnits.
 *
 *   UNIT_REGISTRY — unit.kind → UnitDef
 *                   Defines how each unit kind is measured and rendered.
 *
 * Adding a new ChatItem kind:
 *   1. Implement a UnitDef<D> and an ItemSegmenter in the appropriate folder.
 *   2. Register the segmenter in SEGMENTERS.
 *   3. Register the UnitDef in UNIT_REGISTRY.
 */

import { messageUnitDef } from '@components/rows/message/message.def';
import { planUnitDef } from '@components/rows/plan/plan.def';
import { resourceLinkUnitDef } from '@components/rows/resource-link/resource-link.def';
import { thinkingUnitDef } from '@components/rows/thinking/thinking.def';
import { turnOutcomeUnitDef } from '@components/rows/turn-outcome/turn-outcome.def';
import { diffUnitDef } from '@components/rows/tools/diff/diff.def';
import { executeUnitDef } from '@components/rows/tools/execute/execute.def';
import { fileOpUnitDef } from '@components/rows/tools/file-op/file-op.def';
import { toolGroupUnitDef } from '@components/rows/tools/tool-group/tool-group.def';
import { toolUnitDef } from '@components/rows/tools/tool/tool.def';
import { workingUnitDef } from '@components/rows/working/working.def';
import type { GroupChrome, ItemSegmenter, UnitDef } from '@core/units';
import { unit } from '@core/units';
import type { ItemNode, NodeSegmenter } from '@state/flatten';
import type {
  ChatDiff,
  ChatExecute,
  ChatFileOpToolCall,
  ChatItem,
  ChatMessage,
  ChatPlan,
  ChatToolCall,
  PlanState,
  ToolNode,
  TurnOutcomeItem,
  WorkingItem,
} from '@/model';
import { ROW_INSET_X } from './row-metrics';

// ── Native single-unit segmenter for composites ───────────────────────────────
//
// Each composite item becomes exactly one RenderUnit with chrome.insetX so
// the native UnitDef.measure receives the same effective width as Row.tsx used.

type Segmentable = ChatItem | WorkingItem | TurnOutcomeItem;

// oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
function nativePassthrough(kind: string, toData: (item: any, ctx: any) => unknown, chrome?: GroupChrome): ItemSegmenter<any> {
  return {
    kind,
    chrome,
    // oxlint-disable-next-line typescript/no-explicit-any -- data is ChatItem at runtime
    segment: (item: Segmentable, ctx: any) => [unit(kind, item as ChatItem, toData(item, ctx), { key: 'self' })],
  };
}

/** Chrome shared by all non-user-message composite rows (matches legacy Row.tsx inset). */
const COMPOSITE_CHROME: GroupChrome = { insetX: ROW_INSET_X };

/**
 * User message chrome: full column width (no inset). The card border/padding/bg
 * are handled internally by UserMessageCard, so chrome carries only insetX=0.
 */
const USER_CHROME: GroupChrome = { insetX: 0 };

/**
 * Role-aware message segmenter.
 *
 * Each message becomes exactly one unit with key='self'. The chrome is set
 * per-unit (not on the segmenter) so flatten.ts does not overwrite it with a
 * single shared value — user messages get USER_CHROME (full width), all others
 * get COMPOSITE_CHROME (insetX=ROW_INSET_X).
 */
const messageSegmenter: ItemSegmenter<any> = {
  kind: 'message',
  // No top-level chrome: we set u.chrome per-unit in segment() below so
  // flatten's chrome-copy pass (which only fires when seg.chrome is truthy)
  // cannot overwrite the per-role value we assigned.
  segment: (item, ctx) => {
    const data = toMessageData(item, ctx.active === true);
    const u = unit('message', item, data, { key: 'self' });
    u.chrome = data.role === 'user' ? USER_CHROME : COMPOSITE_CHROME;
    return [u];
  },
};

function pending(ctx: { pendingToolCallIds?: () => Set<string> }, item: { toolCallId?: string }): boolean {
  return !!item.toolCallId && (ctx.pendingToolCallIds?.().has(item.toolCallId) ?? false);
}

function toMessageData(item: ChatMessage, active: boolean): ChatMessage {
  return {
    ...item,
    streaming: active && item.role === 'assistant',
    attachments: item.attachments?.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
    })),
  };
}

function toGenericToolData(item: ToolNode, ctx: { pendingToolCallIds?: () => Set<string> }): ChatToolCall {
  const base = 'toolCallId' in item ? item : null;
  const name =
    item.kind === 'search-tool-call'
      ? 'Search'
      : item.kind === 'mcp-tool-call'
        ? 'MCP'
        : item.kind === 'web-fetch-tool-call'
          ? 'Fetch'
          : item.kind === 'spawn-subagent-tool-call'
            ? 'Subagent'
            : item.kind === 'unknown-tool-call'
              ? item.name
              : 'Tool';
  const inputSummary =
    item.kind === 'search-tool-call'
      ? `${item.query}${item.matchCount !== undefined ? ` (${item.matchCount} matches)` : ''}`
      : item.kind === 'mcp-tool-call'
        ? [item.server, item.tool].filter(Boolean).join('.')
        : item.kind === 'web-fetch-tool-call'
          ? item.pageTitle ?? item.url
          : item.kind === 'spawn-subagent-tool-call'
            ? `${item.name}${item.background ? ' (background)' : ''}`
            : item.kind === 'unknown-tool-call'
              ? item.toolKind ?? undefined
              : base?.inputSummary;
  return {
    kind: 'tool',
    id: item.id,
    name,
    status: 'status' in item ? item.status : 'done',
    awaitingPermission: base ? pending(ctx, base) : false,
    inputSummary,
  };
}

function toExecuteData(item: Extract<ToolNode, { kind: 'execute-tool-call' }>, ctx: { pendingToolCallIds?: () => Set<string> }): ChatExecute {
  return {
    kind: 'execute',
    id: item.id,
    command: item.command ?? item.title,
    status: item.status,
    awaitingPermission: pending(ctx, item),
    startedAt: 0,
    terminalId: item.terminalId,
  };
}

function toReadData(item: Extract<ToolNode, { kind: 'read-tool-call' }>, ctx: { pendingToolCallIds?: () => Set<string> }): ChatFileOpToolCall {
  return {
    kind: 'file-op',
    id: item.id,
    op: 'read',
    status: item.status,
    awaitingPermission: pending(ctx, item),
    ops: item.path || item.resource ? [{ path: item.path ?? item.resource! }] : [],
  };
}

function toDeleteData(item: Extract<ToolNode, { kind: 'delete-file-tool-call' }>, ctx: { pendingToolCallIds?: () => Set<string> }): ChatFileOpToolCall {
  return {
    kind: 'file-op',
    id: item.id,
    op: 'delete',
    status: item.status,
    awaitingPermission: pending(ctx, item),
    ops: [{ path: item.path }],
  };
}

function toCreateFileData(item: Extract<ToolNode, { kind: 'create-file-tool-call' }>, ctx: { pendingToolCallIds?: () => Set<string> }): ChatDiff {
  return {
    kind: 'diff',
    id: item.id,
    path: item.path,
    oldText: null,
    newText: item.content,
    status: item.status,
    awaitingPermission: pending(ctx, item),
  };
}

function toModifyFileData(item: Extract<ToolNode, { kind: 'modify-file-tool-call' }>, ctx: { pendingToolCallIds?: () => Set<string> }): ChatDiff {
  return {
    kind: 'diff',
    id: item.id,
    path: item.path,
    oldText: item.oldText,
    newText: item.newText,
    status: item.status,
    awaitingPermission: pending(ctx, item),
  };
}

function toPlanData(item: Extract<ToolNode, { kind: 'create-plan-tool-call' }>, ctx: { plan?: () => PlanState | null; pendingToolCallIds?: () => Set<string> }): ChatPlan {
  const plan = ctx.plan?.();
  return {
    kind: 'plan',
    id: item.id,
    entries: plan?.entries ?? [],
    streaming: item.status === 'running',
  };
}

function toToolGroupNode(item: ToolNode, ctx: { pendingToolCallIds?: () => Set<string>; plan?: () => PlanState | null }): ItemNode {
  const header =
    item.kind === 'tool-group'
      ? ({ kind: 'tool', id: item.id, name: item.label, status: item.status } satisfies ChatToolCall)
      : toUnitData(item, ctx);
  const children =
    item.kind === 'tool-group'
      ? item.children.map((child: ToolNode) => toToolGroupNode(child, ctx))
      : 'children' in item && item.children
        ? item.children.map((child: ToolNode) => toToolGroupNode(child, ctx))
        : [];
  return { item: header, children };
}

function toUnitData(item: ToolNode, ctx: { pendingToolCallIds?: () => Set<string>; plan?: () => PlanState | null }) {
  switch (item.kind) {
    case 'execute-tool-call':
      return toExecuteData(item, ctx);
    case 'read-tool-call':
      return toReadData(item, ctx);
    case 'create-file-tool-call':
      return toCreateFileData(item, ctx);
    case 'modify-file-tool-call':
      return toModifyFileData(item, ctx);
    case 'delete-file-tool-call':
      return toDeleteData(item, ctx);
    case 'create-plan-tool-call':
      return toPlanData(item, ctx);
    case 'tool-group':
      return toGenericToolData(item, ctx);
    default:
      return toGenericToolData(item, ctx);
  }
}

function toolNodeSegment(kind: ToolNode['kind']): ItemSegmenter<any> {
  return {
    kind,
    chrome: COMPOSITE_CHROME,
    segment(item: ToolNode, ctx) {
      const children = item.kind === 'tool-group' ? item.children : item.children;
      if (children && children.length > 0) {
        return [unit('tool-group', item, toToolGroupNode(item, ctx), { key: 'self' })];
      }
      const data = toUnitData(item, ctx);
      return [unit(data.kind, item, data, { key: 'self' })];
    },
  };
}

// ── SEGMENTERS ────────────────────────────────────────────────────────────────

/**
 * Maps ChatItem.kind to its ItemSegmenter.
 *
 * Composites use nativePassthrough with COMPOSITE_CHROME so that their native
 * UnitDef.measure receives the same effective width as the old Row.tsx path
 * (rowWidth - 2 * ROW_INSET_X). The chrome.insetX is applied visually by
 * UnitRow and subtracted from rowWidth before nativeMeasureCtx.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
export const SEGMENTERS: Record<string, ItemSegmenter<any>> = {
  message: messageSegmenter,
  thinking: nativePassthrough('thinking', (item) => item, COMPOSITE_CHROME),
  tool: nativePassthrough('tool', (item) => item, COMPOSITE_CHROME),
  'file-op': nativePassthrough('file-op', (item) => item, COMPOSITE_CHROME),
  execute: nativePassthrough('execute', (item) => item, COMPOSITE_CHROME),
  diff: nativePassthrough('diff', (item) => item, COMPOSITE_CHROME),
  plan: nativePassthrough('plan', (item) => item, COMPOSITE_CHROME),
  'resource-link': nativePassthrough('resource-link', (item) => item, COMPOSITE_CHROME),
  'execute-tool-call': toolNodeSegment('execute-tool-call'),
  'read-tool-call': toolNodeSegment('read-tool-call'),
  'create-file-tool-call': toolNodeSegment('create-file-tool-call'),
  'modify-file-tool-call': toolNodeSegment('modify-file-tool-call'),
  'delete-file-tool-call': toolNodeSegment('delete-file-tool-call'),
  'search-tool-call': toolNodeSegment('search-tool-call'),
  'mcp-tool-call': toolNodeSegment('mcp-tool-call'),
  'web-fetch-tool-call': toolNodeSegment('web-fetch-tool-call'),
  'spawn-subagent-tool-call': toolNodeSegment('spawn-subagent-tool-call'),
  'create-plan-tool-call': toolNodeSegment('create-plan-tool-call'),
  'unknown-tool-call': toolNodeSegment('unknown-tool-call'),
  'tool-group': toolNodeSegment('tool-group'),
  working: nativePassthrough('working', (item) => item, COMPOSITE_CHROME),
  'turn-outcome': nativePassthrough('turn-outcome', (item) => item, COMPOSITE_CHROME),
};

// ── NODE_SEGMENTERS ───────────────────────────────────────────────────────────

/**
 * Maps ChatItem.kind → NodeSegmenter for items that can be parents.
 *
 * When `flattenTier` discovers that an item has children (other items reference
 * its id via `parentId`), it calls the matching `NodeSegmenter.segmentNode`
 * instead of the regular `ItemSegmenter.segment`. The emitted unit carries the
 * full `ItemNode` (item + children tree) so the composite renderer can recurse.
 */
export const NODE_SEGMENTERS: Record<string, NodeSegmenter> = {
  tool: {
    chrome: COMPOSITE_CHROME,
    segmentNode(node: ItemNode, _ctx) {
      return [unit('tool-group', node.item, node, { key: 'self' })];
    },
  },
  execute: {
    chrome: COMPOSITE_CHROME,
    segmentNode(node: ItemNode, _ctx) {
      return [unit('tool-group', node.item, node, { key: 'self' })];
    },
  },
  'file-op': {
    chrome: COMPOSITE_CHROME,
    segmentNode(node: ItemNode, _ctx) {
      return [unit('tool-group', node.item, node, { key: 'self' })];
    },
  },
  diff: {
    chrome: COMPOSITE_CHROME,
    segmentNode(node: ItemNode, _ctx) {
      return [unit('tool-group', node.item, node, { key: 'self' })];
    },
  },
};

// ── UNIT_REGISTRY ─────────────────────────────────────────────────────────────

/**
 * Maps unit.kind to its UnitDef.
 *
 * message: single-unit def; measure/Render handle block layout internally.
 * Composite item unit defs also handle their own internal layout.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
export const UNIT_REGISTRY: Record<string, UnitDef<any, any>> = {
  // Message unit (single unit per message, renders block stack internally)
  message: messageUnitDef,
  // Composite item units (single-unit per ChatItem kind)
  diff: diffUnitDef,
  plan: planUnitDef,
  thinking: thinkingUnitDef,
  'file-op': fileOpUnitDef,
  tool: toolUnitDef,
  execute: executeUnitDef,
  'resource-link': resourceLinkUnitDef,
  // Hierarchical composite: parent tool call with nested children
  'tool-group': toolGroupUnitDef,
  working: workingUnitDef,
  'turn-outcome': turnOutcomeUnitDef,
};
