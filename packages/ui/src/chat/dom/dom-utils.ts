/**
 * Lightweight DOM helpers used by the imperative renderers.
 *
 * Deliberately thin: no virtual DOM, no diffing.
 * These exist only to reduce boilerplate in render-* files.
 */

/** Shorthand for document.createElement + className + style + children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts?: {
    className?: string;
    style?: Partial<CSSStyleDeclaration>;
    attrs?: Record<string, string>;
    children?: (Node | string | null | undefined)[];
  }
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts?.className) node.className = opts.className;
  if (opts?.style) setStyle(node, opts.style);
  if (opts?.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      node.setAttribute(k, v);
    }
  }
  if (opts?.children) {
    for (const child of opts.children) {
      if (child == null) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return node;
}

/** Apply a partial CSSStyleDeclaration to an element. */
export function setStyle(node: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
  for (const [k, v] of Object.entries(style) as [keyof CSSStyleDeclaration, string][]) {
    if (v !== undefined) (node.style as unknown as Record<string, string>)[k as string] = v;
  }
}

/** Set a CSS custom property on an element. */
export function setCssVar(node: HTMLElement, name: string, value: string): void {
  node.style.setProperty(name, value);
}

/** Remove all children from a node. */
export function clearChildren(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Schedule a callback during a browser idle period.
 * Falls back to `setTimeout(fn, 0)` in environments without `requestIdleCallback`
 * (e.g. tests, Node, older Safari). Returns a handle that can be passed to
 * `cancelIdle` to abort the callback before it fires.
 */
export function scheduleIdle(fn: () => void): number {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(fn);
  }
  return window.setTimeout(fn, 0) as unknown as number;
}

/** Cancel a handle returned by `scheduleIdle`. */
export function cancelIdle(handle: number): void {
  if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(handle);
  } else {
    clearTimeout(handle);
  }
}

/**
 * The lifecycle contract returned by every imperative "component" builder.
 *
 * `node`    — the root DOM element to append into the tree.
 * `dispose` — optional teardown (slot unmounts, reaction disposers, timers).
 *             Call before recycling or removing the element.
 */
export type DomComponent = {
  node: HTMLElement;
  dispose?: () => void;
};
