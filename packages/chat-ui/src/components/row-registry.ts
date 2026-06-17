/**
 * ROW_REGISTRY — maps each ChatItem kind to its RowComponent spec.
 *
 * Row.tsx uses this for dispatch instead of a hand-written Switch/Match.
 * Adding a new row kind means: implement RowComponent, add one entry here.
 * TypeScript enforces that all three members (estimate, measure, Render) exist.
 */

import type { RowComponent } from '../core/layout/spec-types';
import type { ChatItem } from '../model';
import { fileOpRow } from './file-op/spec';
import { messageRow } from './message/spec';
import { thinkingRow } from './thinking/spec';
import { toolRow } from './tool/spec';

// oxlint-disable-next-line typescript/no-explicit-any -- registry boundary; row kinds are type-safe at their own spec files
export const ROW_REGISTRY: Record<ChatItem['kind'], RowComponent<any, any>> = {
  message: messageRow,
  tool: toolRow,
  thinking: thinkingRow,
  'file-op': fileOpRow,
};
