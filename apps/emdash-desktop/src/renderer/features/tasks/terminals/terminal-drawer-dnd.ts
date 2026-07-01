export const TERMINAL_DRAWER_DRAG_KIND = 'terminal-drawer-terminal';

export interface TerminalDrawerDragData {
  kind: typeof TERMINAL_DRAWER_DRAG_KIND;
  terminalId: string;
  label: string;
}

export function isTerminalDrawerDragData(value: unknown): value is TerminalDrawerDragData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<TerminalDrawerDragData>;
  return (
    data.kind === TERMINAL_DRAWER_DRAG_KIND &&
    typeof data.terminalId === 'string' &&
    typeof data.label === 'string'
  );
}
