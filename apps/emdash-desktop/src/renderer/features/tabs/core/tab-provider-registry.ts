import type { TabProvider } from './tab-provider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const definitions = new Map<string, TabProvider<any, any, any, any>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTabProvider(def: TabProvider<any, any, any, any>): void {
  definitions.set(def.kind, def);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tabProviderRegistry: {
  get(kind: string): TabProvider<any, any, any, any>;
  all(): TabProvider<any, any, any, any>[];
  has(kind: string): boolean;
} = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(kind: string): TabProvider<any, any, any, any> {
    const def = definitions.get(kind);
    if (!def) throw new Error(`No tab provider registered for kind: ${kind}`);
    return def;
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all(): TabProvider<any, any, any, any>[] {
    return [...definitions.values()];
  },
  has(kind: string): boolean {
    return definitions.has(kind);
  },
};
