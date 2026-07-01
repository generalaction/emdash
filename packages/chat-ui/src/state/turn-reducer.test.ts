/**
 * turn-reducer — unit tests for parentId propagation.
 *
 * Verifies that `parentId` supplied on *_start events is persisted on the
 * created ChatItem, and that events without `parentId` produce items without
 * the field (or with `parentId === undefined`).
 */

import { describe, expect, it } from 'vitest';
import type { ChatDiff, ChatExecute, ChatFileOpToolCall, ChatToolCall } from '@/model';
import { applyTurnEvent } from './turn-reducer';

describe('applyTurnEvent — parentId propagation', () => {
  describe('tool_start', () => {
    it('persists parentId when provided', () => {
      const result = applyTurnEvent(null, {
        type: 'tool_start',
        id: 'c1',
        name: 'search',
        parentId: 'p1',
      });
      const item = result.find((it) => it.id === 'c1') as ChatToolCall;
      expect(item.parentId).toBe('p1');
    });

    it('omits parentId when not provided', () => {
      const result = applyTurnEvent(null, { type: 'tool_start', id: 't1', name: 'search' });
      const item = result.find((it) => it.id === 't1') as ChatToolCall;
      expect(item.parentId).toBeUndefined();
    });
  });

  describe('execute_start', () => {
    it('persists parentId when provided', () => {
      const result = applyTurnEvent(null, {
        type: 'execute_start',
        id: 'ex1',
        command: 'ls -a',
        parentId: 'p1',
      });
      const item = result.find((it) => it.id === 'ex1') as ChatExecute;
      expect(item.parentId).toBe('p1');
    });

    it('omits parentId when not provided', () => {
      const result = applyTurnEvent(null, {
        type: 'execute_start',
        id: 'ex2',
        command: 'ls -a',
      });
      const item = result.find((it) => it.id === 'ex2') as ChatExecute;
      expect(item.parentId).toBeUndefined();
    });
  });

  describe('file_op_start', () => {
    it('persists parentId when provided', () => {
      const result = applyTurnEvent(null, {
        type: 'file_op_start',
        id: 'fo1',
        op: 'read',
        ops: [{ path: 'foo.ts' }],
        parentId: 'p1',
      });
      const item = result.find((it) => it.id === 'fo1') as ChatFileOpToolCall;
      expect(item.parentId).toBe('p1');
    });

    it('omits parentId when not provided', () => {
      const result = applyTurnEvent(null, {
        type: 'file_op_start',
        id: 'fo2',
        op: 'read',
        ops: [{ path: 'foo.ts' }],
      });
      const item = result.find((it) => it.id === 'fo2') as ChatFileOpToolCall;
      expect(item.parentId).toBeUndefined();
    });
  });

  describe('diff_start', () => {
    it('persists parentId when provided', () => {
      const result = applyTurnEvent(null, {
        type: 'diff_start',
        id: 'd1',
        path: 'src/foo.ts',
        oldText: 'old',
        newText: 'new',
        parentId: 'p1',
      });
      const item = result.find((it) => it.id === 'd1') as ChatDiff;
      expect(item.parentId).toBe('p1');
    });

    it('omits parentId when not provided', () => {
      const result = applyTurnEvent(null, {
        type: 'diff_start',
        id: 'd2',
        path: 'src/foo.ts',
        oldText: 'old',
        newText: 'new',
      });
      const item = result.find((it) => it.id === 'd2') as ChatDiff;
      expect(item.parentId).toBeUndefined();
    });
  });
});
