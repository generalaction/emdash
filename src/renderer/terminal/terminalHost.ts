let hostElement: HTMLDivElement | null = null;

export function ensureTerminalHost(): HTMLDivElement {
  if (hostElement) return hostElement;
  const el = document.createElement('div');
  el.setAttribute('data-terminal-host', 'true');
  Object.assign(el.style, {
    // Important: give the hidden host a non-zero size so xterm can
    // correctly measure character dimensions even when not attached.
    // Keep it far offscreen and non-interactive.
    position: 'fixed',
    left: '-10000px',
    top: '0px',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '-1',
  } as CSSStyleDeclaration);
  document.body.appendChild(el);
  hostElement = el;
  return el;
}
