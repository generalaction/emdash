/**
 * Tiny external store for panel-drag state, compatible with useSyncExternalStore.
 *
 * Written to by layout-provider.tsx (via handleDragging) and read by
 * use-terminals.ts so terminals can suppress fitAddon.fit() during a drag and
 * fire exactly one fit+PTY-resize when the drag ends — without a global window
 * event.
 */

type Listener = () => void;

let isDragging = false;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return isDragging;
}

function setDragging(value: boolean): void {
  if (isDragging === value) return;
  isDragging = value;
  for (const listener of listeners) listener();
}

export const panelDragStore = { subscribe, getSnapshot, setDragging };
