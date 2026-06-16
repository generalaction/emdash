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
