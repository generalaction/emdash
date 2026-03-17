export interface ExpandedTerminalKeydownEventLike {
  key: string;
  target?: EventTarget | null;
}

export function shouldCloseExpandedTerminal(event: ExpandedTerminalKeydownEventLike): boolean {
  return event.key === 'Escape';
}
