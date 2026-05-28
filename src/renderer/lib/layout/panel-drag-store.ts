/**
 * Tiny external store for panel resize suppression, compatible with
 * useSyncExternalStore.
 *
 * Manual drags set the dragging bit directly. Programmatic panel toggles use a
 * short suppression window so xterm is resized once after react-resizable-panels
 * finishes its resize burst, avoiding repeated term.resize() calls while
 * keeping real drags responsive.
 */

type Listener = () => void;

let isDragging = false;
let isSuppressing = false;
let suppressTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function getCurrentValue() {
  return isDragging || isSuppressing;
}

function notifyIfChanged(previous: boolean) {
  if (previous === getCurrentValue()) return;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return getCurrentValue();
}

function setDragging(value: boolean): void {
  if (isDragging === value) return;
  const previous = getCurrentValue();
  isDragging = value;
  notifyIfChanged(previous);
}

function suppressFor(ms: number): void {
  const previous = getCurrentValue();
  isSuppressing = true;
  if (suppressTimer) clearTimeout(suppressTimer);
  suppressTimer = setTimeout(() => {
    const beforeTimer = getCurrentValue();
    suppressTimer = null;
    isSuppressing = false;
    notifyIfChanged(beforeTimer);
  }, ms);
  notifyIfChanged(previous);
}

export const panelDragStore = { subscribe, getSnapshot, setDragging, suppressFor };
