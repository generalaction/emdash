/**
 * Content Kanban Store
 * Supports dynamic column statuses for content workspaces.
 * Unlike the original kanbanStore which uses hardcoded statuses,
 * this store allows any string-based status values.
 */

// Default content workflow columns
export const DEFAULT_CONTENT_COLUMNS = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'research', title: 'Research' },
  { id: 'writing', title: 'Writing' },
  { id: 'review', title: 'Review' },
  { id: 'ready', title: 'Ready' },
] as const;

export type ContentColumnId = (typeof DEFAULT_CONTENT_COLUMNS)[number]['id'];

export interface ContentColumn {
  id: string;
  title: string;
}

const STORAGE_KEY = 'emdash:content-kanban:statusByTask';

type MapShape = Record<string, string>;

let cache: MapShape | null = null;

function read(): MapShape {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        cache = parsed as MapShape;
        return cache;
      }
    }
  } catch {
    // ignore parse errors
  }
  cache = {};
  return cache;
}

function write(next: MapShape) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
}

/**
 * Get the content kanban status for a task.
 * Returns the first column ID if not set.
 */
export function getContentStatus(taskId: string, defaultStatus = 'backlog'): string {
  const map = read();
  return map[taskId] || defaultStatus;
}

/**
 * Set the content kanban status for a task.
 */
export function setContentStatus(taskId: string, status: string): void {
  const map = { ...read(), [taskId]: status };
  write(map);
}

/**
 * Get all task statuses.
 */
export function getAllContentStatuses(): MapShape {
  return { ...read() };
}

/**
 * Clear all content kanban statuses.
 */
export function clearAllContentStatuses(): void {
  write({});
}

/**
 * Parse kanban columns from JSON string (stored in workspace).
 */
export function parseKanbanColumns(json: string | null | undefined): ContentColumn[] {
  if (!json) return [...DEFAULT_CONTENT_COLUMNS];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.every((c) => c.id && c.title)) {
      return parsed;
    }
  } catch {
    // ignore parse errors
  }
  return [...DEFAULT_CONTENT_COLUMNS];
}

/**
 * Serialize kanban columns to JSON string for storage.
 */
export function serializeKanbanColumns(columns: ContentColumn[]): string {
  return JSON.stringify(columns);
}
