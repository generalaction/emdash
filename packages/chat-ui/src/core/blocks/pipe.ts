/**
 * Functional pipe utilities for block transformation pipelines.
 *
 * `pipe` threads a value through a series of transform functions left-to-right.
 * `flow` composes a series of functions into a single function without an
 * initial value (useful for creating reusable pipelines).
 *
 * Both are typed to preserve the return type of the last function.
 *
 * @example
 * const blocks = pipe(
 *   parseMarkdownToBlocksCached(id, text),
 *   flattenBlockHeadings,
 * );
 *
 * @example
 * const buildThinkingBlocks = flow(
 *   (item: ChatThinking) => parseMarkdownToBlocksCached(item.id, item.text ?? ''),
 *   flattenBlockHeadings,
 * );
 */

/** Thread `value` through one function. */
export function pipe<A, B>(value: A, fn1: (a: A) => B): B;
/** Thread `value` through two functions. */
export function pipe<A, B, C>(value: A, fn1: (a: A) => B, fn2: (b: B) => C): C;
/** Thread `value` through three functions. */
export function pipe<A, B, C, D>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D
): D;
/** Thread `value` through four functions. */
export function pipe<A, B, C, D, E>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E
): E;

// oxlint-disable-next-line typescript/no-explicit-any -- variadic overload implementation
export function pipe(value: any, ...fns: Array<(x: any) => any>): any {
  return fns.reduce((acc, fn) => fn(acc), value);
}
