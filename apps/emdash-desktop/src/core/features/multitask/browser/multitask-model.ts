import { arrayMove } from '@dnd-kit/sortable';
import type { AgentStatus } from '@core/primitives/agents/api';

/** One selected cell in the multitask grid, identified by its ACP conversation. */
export type MultitaskCell = Readonly<{
  projectId: string;
  taskId: string;
  conversationId: string;
}>;

export type MultitaskConversationInput = Readonly<{
  id: string;
  title: string;
  providerId: string;
  status: AgentStatus;
}>;

export type MultitaskTaskInput = Readonly<{
  id: string;
  name: string;
  isArchived: boolean;
  conversations: readonly MultitaskConversationInput[];
}>;

export type MultitaskProjectInput = Readonly<{
  id: string;
  name: string;
  tasks: readonly MultitaskTaskInput[];
}>;

export type MultitaskConversationRow = MultitaskConversationInput &
  Readonly<{
    isLive: boolean;
  }>;

export type MultitaskTaskGroup = Readonly<{
  id: string;
  name: string;
  conversations: readonly MultitaskConversationRow[];
}>;

export type MultitaskProjectGroup = Readonly<{
  id: string;
  name: string;
  tasks: readonly MultitaskTaskGroup[];
}>;

/** Matches cockpit's definition of "currently running" (see cockpit-model.ts). */
export function isLiveAgentStatus(status: AgentStatus): boolean {
  return status === 'working' || status === 'awaiting-input' || status === 'error';
}

/**
 * Builds the picker's grouped project -> task -> conversation tree.
 *
 * Archived tasks are always excluded. When `liveOnly` is set, conversations
 * that are not currently live are filtered out too; otherwise every
 * conversation of every non-archived task is included.
 */
export function buildMultitaskGroups(
  projects: readonly MultitaskProjectInput[],
  options: Readonly<{ liveOnly: boolean }>
): MultitaskProjectGroup[] {
  const groups: MultitaskProjectGroup[] = [];

  for (const project of projects) {
    const tasks: MultitaskTaskGroup[] = [];

    for (const task of project.tasks) {
      if (task.isArchived) continue;

      const conversations: MultitaskConversationRow[] = [];
      for (const conversation of task.conversations) {
        const isLive = isLiveAgentStatus(conversation.status);
        if (options.liveOnly && !isLive) continue;
        conversations.push({ ...conversation, isLive });
      }

      if (conversations.length === 0) continue;
      tasks.push({ id: task.id, name: task.name, conversations });
    }

    if (tasks.length === 0) continue;
    groups.push({ id: project.id, name: project.name, tasks });
  }

  return groups;
}

export function cellKey(cell: MultitaskCell): string {
  return `${cell.projectId}::${cell.taskId}::${cell.conversationId}`;
}

export function hasCell(cells: readonly MultitaskCell[], cell: MultitaskCell): boolean {
  const key = cellKey(cell);
  return cells.some((candidate) => cellKey(candidate) === key);
}

/** Adds `cell` if it is not selected yet, otherwise removes it. */
export function toggleCell(cells: readonly MultitaskCell[], cell: MultitaskCell): MultitaskCell[] {
  return hasCell(cells, cell) ? removeCell(cells, cell) : [...cells, cell];
}

export function removeCell(cells: readonly MultitaskCell[], cell: MultitaskCell): MultitaskCell[] {
  const key = cellKey(cell);
  return cells.filter((candidate) => cellKey(candidate) !== key);
}

/** Toggles whether a selected cell is hidden from the workspace but kept in the tab strip. */
export function toggleMinimizedCell(
  minimizedCellKeys: readonly string[],
  cell: MultitaskCell
): string[] {
  const key = cellKey(cell);
  return minimizedCellKeys.includes(key)
    ? minimizedCellKeys.filter((candidate) => candidate !== key)
    : [...minimizedCellKeys, key];
}

/** Completion attention is emitted only for conversations observed running in this view. */
export function isNewlyCompleted(
  previous: AgentStatus | undefined,
  current: AgentStatus
): boolean {
  return previous !== undefined && isLiveAgentStatus(previous) && current === 'completed';
}

export function reorderCells(
  cells: readonly MultitaskCell[],
  fromIndex: number,
  toIndex: number
): MultitaskCell[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= cells.length ||
    toIndex >= cells.length ||
    fromIndex === toIndex
  ) {
    return [...cells];
  }
  return arrayMove([...cells], fromIndex, toIndex);
}

/** The set of conversation cell keys that currently exist, for pruning deleted selections. */
export function buildKnownCellKeys(projects: readonly MultitaskProjectInput[]): Set<string> {
  const keys = new Set<string>();
  for (const project of projects) {
    for (const task of project.tasks) {
      for (const conversation of task.conversations) {
        keys.add(
          cellKey({
            projectId: project.id,
            taskId: task.id,
            conversationId: conversation.id,
          })
        );
      }
    }
  }
  return keys;
}

/**
 * Drops cells whose task or conversation no longer exists (deleted task,
 * deleted conversation). Cells that simply stopped being "live" are kept —
 * only the user removes those, via the close button.
 */
export function pruneMissingCells(
  cells: readonly MultitaskCell[],
  knownKeys: ReadonlySet<string>
): MultitaskCell[] {
  return cells.filter((cell) => knownKeys.has(cellKey(cell)));
}

/** Splits a flat list of items into rows of at most `columns` items each. */
export function chunkIntoRows<T>(items: readonly T[], columns: number): T[][] {
  const safeColumns = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += safeColumns) {
    rows.push(items.slice(index, index + safeColumns));
  }
  return rows;
}

export function clampColumns(columns: number): number {
  if (!Number.isFinite(columns)) return 2;
  return Math.min(4, Math.max(1, Math.round(columns)));
}

/** Missing conversations are trustworthy only after every visible project finished hydrating. */
export function canPruneMissingCells(projectViewKinds: readonly string[]): boolean {
  return projectViewKinds.length > 0 && projectViewKinds.every((kind) => kind === 'ready');
}
