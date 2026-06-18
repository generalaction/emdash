/**
 * REGISTRY — single map from NodeKind to ComponentDef.
 *
 * Covers both row kinds (ChatItem.kind) and block kinds (Block.kind),
 * replacing the separate ROW_REGISTRY and per-spec BlockSpec pattern.
 *
 * Row.tsx dispatches row-level estimate/measure/Render through this map.
 * Composite defs (message, thinking) dispatch block-level children through
 * the same map when building their internal block stack via layoutBlocks.
 *
 * Adding a new kind:
 *   1. Implement a ComponentDef in the appropriate component folder.
 *   2. Add one line here.  TypeScript enforces the full ComponentDef shape.
 */

import type { ComponentDef } from '../core/define';
import { codeDef } from './code/code.def';
import { diffDef } from './diff/diff.def';
import { executeDef } from './execute/execute.def';
import { fileOpDef } from './file-op/file-op.def';
import { messageDef } from './message/message.def';
import { proseDef } from './prose/prose.def';
import { tableDef } from './table/table.def';
import { thinkingDef } from './thinking/thinking.def';
import { toolDef } from './tool/tool.def';

/** Union of all dispatchable kinds in the unified registry. */
export type NodeKind =
  | 'message'
  | 'tool'
  | 'thinking'
  | 'file-op'
  | 'execute'
  | 'diff'
  | 'prose'
  | 'code'
  | 'table';

// oxlint-disable-next-line typescript/no-explicit-any -- registry boundary; each kind is type-safe at its own def file
export const REGISTRY: Record<NodeKind, ComponentDef<any, any>> = {
  // Row kinds
  message: messageDef,
  tool: toolDef,
  thinking: thinkingDef,
  'file-op': fileOpDef,
  execute: executeDef,
  diff: diffDef,
  // Block tiers
  prose: proseDef,
  code: codeDef,
  table: tableDef,
};
