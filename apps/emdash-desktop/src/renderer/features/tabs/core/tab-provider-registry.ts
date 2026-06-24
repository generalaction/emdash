import type { TabProvider } from './tab-provider';

// ── Type aliases ──────────────────────────────────────────────────────────────

// oxlint-disable-next-line typescript/no-explicit-any -- Registry boundary must preserve provider variance.
export type AnyTabProvider = TabProvider<any, any, any, any, any>;

/**
 * Extract the literal kind union from a typed registry.
 */
export type KindOf<R extends TabRegistry> =
  R extends TypedTabRegistry<infer P> ? P[number]['kind'] : string;

/**
 * Extract the OpenArgs type for a given kind from a typed registry.
 */
export type OpenArgsOf<R extends TabRegistry, K extends KindOf<R>> =
  R extends TypedTabRegistry<infer P>
    ? Extract<P[number], { kind: K }> extends TabProvider<K, object, object, unknown, infer A>
      ? A
      : unknown
    : unknown;

// ── Registry interface ────────────────────────────────────────────────────────

/**
 * Immutable registry of tab providers, constructed via createTabRegistry.
 * Each PaneStore holds a reference; React chrome reads it off the store
 * through PaneContext so no extra React context is needed.
 */
export interface TabRegistry {
  get(kind: string): AnyTabProvider;
  all(): AnyTabProvider[];
  has(kind: string): boolean;
}

/** Typed registry that retains the full provider tuple for type inference. */
export interface TypedTabRegistry<P extends readonly AnyTabProvider[]> extends TabRegistry {
  /** @internal Used for type-level inference only; do not call at runtime. */
  readonly _providers: P;
}

// ── Factories ─────────────────────────────────────────────────────────────────

/**
 * Identity helper that captures the generic parameters so providers
 * can be authored as plain object literals without losing type inference.
 *
 * ```ts
 * export const myTabProvider = createTabProvider({
 *   kind: 'my-kind',
 *   resolve(entry, ctx) { ... },
 *   ...
 * });
 * ```
 */
export function createTabProvider<
  K extends string,
  E extends object,
  RD extends object,
  Data,
  OpenArgs,
>(impl: TabProvider<K, E, RD, Data, OpenArgs>): TabProvider<K, E, RD, Data, OpenArgs> {
  return impl;
}

/**
 * Builds an immutable TypedTabRegistry from a const tuple of providers.
 * Call once per view that needs a tab surface (e.g. in task-tab-registry.ts).
 */
export function createTabRegistry<const P extends readonly AnyTabProvider[]>(
  providers: P
): TypedTabRegistry<P> {
  const map = new Map<string, AnyTabProvider>();
  for (const p of providers) {
    map.set(p.kind, p);
  }
  const registry: TypedTabRegistry<P> = {
    get(kind: string): AnyTabProvider {
      const def = map.get(kind);
      if (!def) throw new Error(`No tab provider registered for kind: ${kind}`);
      return def;
    },
    all(): AnyTabProvider[] {
      return [...map.values()];
    },
    has(kind: string): boolean {
      return map.has(kind);
    },
    _providers: providers,
  };
  return registry;
}
