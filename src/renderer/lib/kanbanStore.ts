import type { Workspace } from '../types/app';

export type KanbanStatus = 'todo' | 'in-progress' | 'done';

const STORAGE_KEY = 'emdash:kanban:statusByWorkspace';

type MapShape = Record<string, KanbanStatus>;

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
  } catch {}
  cache = {};
  return cache;
}

function write(next: MapShape) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

export function getStatus(workspaceId: string): KanbanStatus {
  const map = read();
  return (map[workspaceId] as KanbanStatus) || 'todo';
}

export function setStatus(workspaceId: string, status: KanbanStatus): void {
  const map = { ...read(), [workspaceId]: status };
  write(map);
}

export function getAll(): MapShape {
  return { ...read() };
}

export function clearAll(): void {
  write({});
}
