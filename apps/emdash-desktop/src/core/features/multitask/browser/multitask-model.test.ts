import { describe, expect, it } from 'vitest';
import {
  buildKnownCellKeys,
  buildMultitaskGroups,
  canPruneMissingCells,
  cellKey,
  chunkIntoRows,
  clampColumns,
  hasCell,
  isLiveAgentStatus,
  isNewlyCompleted,
  type MultitaskCell,
  type MultitaskProjectInput,
  pruneMissingCells,
  removeCell,
  reorderCells,
  toggleMinimizedCell,
  toggleCell,
} from './multitask-model';

const projects: MultitaskProjectInput[] = [
  {
    id: 'proj-1',
    name: 'Proyecto 1',
    tasks: [
      {
        id: 'task-1',
        name: 'Tarea 1',
        isArchived: false,
        conversations: [
          { id: 'conv-1', title: 'Chat 1', providerId: 'claude', status: 'working' },
          { id: 'conv-2', title: 'Chat 2', providerId: 'codex', status: 'idle' },
        ],
      },
      {
        id: 'task-2',
        name: 'Tarea archivada',
        isArchived: true,
        conversations: [{ id: 'conv-3', title: 'Chat 3', providerId: 'claude', status: 'working' }],
      },
    ],
  },
  {
    id: 'proj-2',
    name: 'Proyecto 2',
    tasks: [
      {
        id: 'task-3',
        name: 'Tarea 3',
        isArchived: false,
        conversations: [
          { id: 'conv-4', title: 'Chat 4', providerId: 'cursor', status: 'completed' },
        ],
      },
    ],
  },
];

describe('isLiveAgentStatus', () => {
  it('treats working, awaiting-input and error as live', () => {
    expect(isLiveAgentStatus('working')).toBe(true);
    expect(isLiveAgentStatus('awaiting-input')).toBe(true);
    expect(isLiveAgentStatus('error')).toBe(true);
  });

  it('treats idle and completed as not live', () => {
    expect(isLiveAgentStatus('idle')).toBe(false);
    expect(isLiveAgentStatus('completed')).toBe(false);
  });
});

describe('buildMultitaskGroups', () => {
  it('excludes archived tasks regardless of liveOnly', () => {
    const groups = buildMultitaskGroups(projects, { liveOnly: false });
    const proj1 = groups.find((group) => group.id === 'proj-1');
    expect(proj1?.tasks.map((task) => task.id)).toEqual(['task-1']);
  });

  it('includes every conversation of non-archived tasks when liveOnly is false', () => {
    const groups = buildMultitaskGroups(projects, { liveOnly: false });
    const proj1 = groups.find((group) => group.id === 'proj-1');
    expect(proj1?.tasks[0]?.conversations.map((c) => c.id)).toEqual(['conv-1', 'conv-2']);
  });

  it('filters down to live conversations only when liveOnly is true', () => {
    const groups = buildMultitaskGroups(projects, { liveOnly: true });
    const proj1 = groups.find((group) => group.id === 'proj-1');
    expect(proj1?.tasks[0]?.conversations.map((c) => c.id)).toEqual(['conv-1']);
    // proj-2's only conversation is "completed", so it drops out entirely.
    expect(groups.find((group) => group.id === 'proj-2')).toBeUndefined();
  });

  it('drops a task group entirely when it has no conversations left', () => {
    const groups = buildMultitaskGroups(projects, { liveOnly: true });
    const proj2 = groups.find((group) => group.id === 'proj-2');
    expect(proj2).toBeUndefined();
  });

  it('marks each conversation row with its live flag', () => {
    const groups = buildMultitaskGroups(projects, { liveOnly: false });
    const proj1 = groups.find((group) => group.id === 'proj-1');
    const rows = proj1?.tasks[0]?.conversations ?? [];
    expect(rows.find((row) => row.id === 'conv-1')?.isLive).toBe(true);
    expect(rows.find((row) => row.id === 'conv-2')?.isLive).toBe(false);
  });
});

describe('cell selection helpers', () => {
  const cellA: MultitaskCell = { projectId: 'proj-1', taskId: 'task-1', conversationId: 'conv-1' };
  const cellB: MultitaskCell = { projectId: 'proj-1', taskId: 'task-1', conversationId: 'conv-2' };

  it('cellKey is stable for identical cells and distinct for different ones', () => {
    expect(cellKey(cellA)).toBe(cellKey({ ...cellA }));
    expect(cellKey(cellA)).not.toBe(cellKey(cellB));
  });

  it('hasCell finds a matching cell by identity fields', () => {
    expect(hasCell([cellA], cellA)).toBe(true);
    expect(hasCell([cellA], cellB)).toBe(false);
  });

  it('toggleCell adds a cell that is not selected yet', () => {
    const next = toggleCell([cellA], cellB);
    expect(next).toEqual([cellA, cellB]);
  });

  it('toggleCell removes a cell that is already selected', () => {
    const next = toggleCell([cellA, cellB], cellA);
    expect(next).toEqual([cellB]);
  });

  it('removeCell drops only the matching cell', () => {
    const next = removeCell([cellA, cellB], cellA);
    expect(next).toEqual([cellB]);
  });
});

describe('reorderCells', () => {
  const cells: MultitaskCell[] = [
    { projectId: 'p', taskId: 't', conversationId: 'a' },
    { projectId: 'p', taskId: 't', conversationId: 'b' },
    { projectId: 'p', taskId: 't', conversationId: 'c' },
  ];

  it('moves a cell from one index to another', () => {
    const next = reorderCells(cells, 0, 2);
    expect(next.map((c) => c.conversationId)).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op for an out-of-range index', () => {
    expect(reorderCells(cells, 0, 10)).toEqual(cells);
    expect(reorderCells(cells, -1, 1)).toEqual(cells);
  });

  it('is a no-op when from equals to', () => {
    expect(reorderCells(cells, 1, 1)).toEqual(cells);
  });
});

describe('pruneMissingCells', () => {
  it('waits for project hydration before trusting missing conversations', () => {
    expect(canPruneMissingCells(['ready', 'hydrating'])).toBe(false);
    expect(canPruneMissingCells([])).toBe(false);
    expect(canPruneMissingCells(['ready', 'ready'])).toBe(true);
  });

  it('keeps cells that still exist and drops cells that do not', () => {
    const knownKeys = buildKnownCellKeys(projects);
    const cells: MultitaskCell[] = [
      { projectId: 'proj-1', taskId: 'task-1', conversationId: 'conv-1' },
      { projectId: 'proj-1', taskId: 'task-1', conversationId: 'conv-deleted' },
    ];
    const pruned = pruneMissingCells(cells, knownKeys);
    expect(pruned).toEqual([cells[0]]);
  });

  it('keeps cells pointing at archived tasks (archival is not deletion)', () => {
    const knownKeys = buildKnownCellKeys(projects);
    const cells: MultitaskCell[] = [
      { projectId: 'proj-1', taskId: 'task-2', conversationId: 'conv-3' },
    ];
    expect(pruneMissingCells(cells, knownKeys)).toEqual(cells);
  });

  it('keeps cells that are merely not live', () => {
    const groups = buildMultitaskGroups(projects, { liveOnly: true });
    void groups; // the live-filtered view must never drive pruning
    const knownKeys = buildKnownCellKeys(projects);
    const cells: MultitaskCell[] = [
      { projectId: 'proj-1', taskId: 'task-1', conversationId: 'conv-2' },
    ];
    expect(pruneMissingCells(cells, knownKeys)).toEqual(cells);
  });
});

describe('chunkIntoRows', () => {
  it('splits items into rows of the given column count', () => {
    expect(chunkIntoRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('treats a non-positive column count as 1', () => {
    expect(chunkIntoRows([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe('clampColumns', () => {
  it('clamps within [1, 4]', () => {
    expect(clampColumns(0)).toBe(1);
    expect(clampColumns(5)).toBe(4);
    expect(clampColumns(3)).toBe(3);
  });

  it('falls back to 2 for non-finite input', () => {
    expect(clampColumns(Number.NaN)).toBe(2);
  });
});

describe('minimized cells', () => {
  const cell: MultitaskCell = {
    projectId: 'proj-1',
    taskId: 'task-1',
    conversationId: 'conv-1',
  };

  it('minimizes an open cell and restores a minimized cell', () => {
    const minimized = toggleMinimizedCell([], cell);
    expect(minimized).toEqual([cellKey(cell)]);
    expect(toggleMinimizedCell(minimized, cell)).toEqual([]);
  });

  it('detects only a live-to-completed transition as newly completed', () => {
    expect(isNewlyCompleted('working', 'completed')).toBe(true);
    expect(isNewlyCompleted('awaiting-input', 'completed')).toBe(true);
    expect(isNewlyCompleted('completed', 'completed')).toBe(false);
    expect(isNewlyCompleted(undefined, 'completed')).toBe(false);
    expect(isNewlyCompleted('working', 'error')).toBe(false);
  });
});
