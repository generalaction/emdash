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

export function getStatus(taskId: string): KanbanStatus {
  const map = read();
  return (map[taskId] as KanbanStatus) || 'todo';
}

export function setStatus(taskId: string, status: KanbanStatus): void {
  const map = { ...read(), [taskId]: status };
  write(map);
}

export function getAll(): MapShape {
  return { ...read() };
}

export function clearAll(): void {
  write({});
}
