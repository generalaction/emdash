import { describe, expect, it } from 'vitest';
import { parseTerminalValue, resolveSelection } from '../../renderer/hooks/useTerminalSelection';

// Type alias matching the store's return shape
type Terminals = {
  terminals: { id: string }[];
  activeTerminalId: string | null;
};

function makeTerminals(ids: string[], activeId?: string | null): Terminals {
  return {
    terminals: ids.map((id) => ({ id })),
    activeTerminalId: activeId ?? ids[0] ?? null,
  };
}

describe('parseTerminalValue', () => {
  it('parses task value', () => {
    expect(parseTerminalValue('task::abc')).toEqual({ mode: 'task', id: 'abc' });
  });

  it('parses global value', () => {
    expect(parseTerminalValue('global::xyz')).toEqual({ mode: 'global', id: 'xyz' });
  });

  it('parses lifecycle value', () => {
    expect(parseTerminalValue('lifecycle::setup')).toEqual({ mode: 'lifecycle', id: 'setup' });
  });

  it('returns null for empty string', () => {
    expect(parseTerminalValue('')).toBeNull();
  });

  it('returns null for invalid format', () => {
    expect(parseTerminalValue('invalid')).toBeNull();
  });
});

describe('resolveSelection', () => {
  describe('task switch', () => {
    it('resets to first worktree terminal on task switch', () => {
      const result = resolveSelection({
        currentValue: 'global::g1',
        taskId: 'task-2',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals(['t1', 't2']),
        globalTerminals: makeTerminals(['g1', 'g2']),
      });
      expect(result).toBe('task::t1');
    });

    it('falls back to global if no worktree terminals on task switch', () => {
      const result = resolveSelection({
        currentValue: 'task::old',
        taskId: 'task-2',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals([]),
        globalTerminals: makeTerminals(['g1']),
      });
      expect(result).toBe('global::g1');
    });

    it('clears selection if no terminals at all on task switch', () => {
      const result = resolveSelection({
        currentValue: 'task::old',
        taskId: 'task-2',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals([]),
        globalTerminals: makeTerminals([]),
      });
      expect(result).toBe('');
    });

    it('resets from lifecycle mode on task switch', () => {
      const result = resolveSelection({
        currentValue: 'lifecycle::setup',
        taskId: 'task-2',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals(['t1']),
        globalTerminals: makeTerminals(['g1']),
      });
      expect(result).toBe('task::t1');
    });
  });

  describe('no selection', () => {
    it('picks first task terminal when no selection', () => {
      const result = resolveSelection({
        currentValue: '',
        taskId: 'task-1',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals(['t1']),
        globalTerminals: makeTerminals(['g1']),
      });
      expect(result).toBe('task::t1');
    });

    it('picks first global terminal when no task terminals and no selection', () => {
      const result = resolveSelection({
        currentValue: '',
        taskId: 'task-1',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals([]),
        globalTerminals: makeTerminals(['g1']),
      });
      expect(result).toBe('global::g1');
    });
  });

  describe('task deselected', () => {
    it('switches to global when task is removed and mode was task', () => {
      const result = resolveSelection({
        currentValue: 'task::t1',
        taskId: null,
        prevTaskId: null,
        taskTerminals: makeTerminals([]),
        globalTerminals: makeTerminals(['g1']),
      });
      expect(result).toBe('global::g1');
    });
  });

  describe('lifecycle mode', () => {
    it('returns null (no change) when in lifecycle mode', () => {
      const result = resolveSelection({
        currentValue: 'lifecycle::setup',
        taskId: 'task-1',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals(['t1']),
        globalTerminals: makeTerminals(['g1']),
      });
      expect(result).toBeNull();
    });
  });

  describe('terminal still exists', () => {
    it('returns null (no change) when selected task terminal still exists', () => {
      const result = resolveSelection({
        currentValue: 'task::t1',
        taskId: 'task-1',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals(['t1', 't2']),
        globalTerminals: makeTerminals(['g1']),
      });
      expect(result).toBeNull();
    });

    it('returns null (no change) when selected global terminal still exists', () => {
      const result = resolveSelection({
        currentValue: 'global::g1',
        taskId: 'task-1',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals(['t1']),
        globalTerminals: makeTerminals(['g1']),
      });
      expect(result).toBeNull();
    });
  });

  describe('terminal deleted (stay in type)', () => {
    it('uses store activeId when task terminal is deleted', () => {
      const result = resolveSelection({
        currentValue: 'task::t2',
        taskId: 'task-1',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals(['t1', 't3'], 't3'),
        globalTerminals: makeTerminals(['g1']),
      });
      expect(result).toBe('task::t3');
    });

    it('uses store activeId when global terminal is deleted', () => {
      const result = resolveSelection({
        currentValue: 'global::g2',
        taskId: 'task-1',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals(['t1']),
        globalTerminals: makeTerminals(['g1', 'g3'], 'g3'),
      });
      expect(result).toBe('global::g3');
    });

    it('falls back to other type when all terminals of current type are gone', () => {
      const result = resolveSelection({
        currentValue: 'global::g1',
        taskId: 'task-1',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals(['t1']),
        globalTerminals: makeTerminals([], null),
      });
      expect(result).toBe('task::t1');
    });

    it('clears when no terminals remain anywhere', () => {
      const result = resolveSelection({
        currentValue: 'task::t1',
        taskId: 'task-1',
        prevTaskId: 'task-1',
        taskTerminals: makeTerminals([], null),
        globalTerminals: makeTerminals([], null),
      });
      expect(result).toBe('');
    });
  });
});
