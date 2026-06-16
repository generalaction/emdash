/**
 * ViewState — Solid signal-based replacement for MobX ViewStateStore.
 *
 * Uses a Solid store (Record<string, boolean>) for fine-grained per-key
 * reactivity: when isCollapsed(id) is called inside a reactive context
 * (createMemo, createEffect, JSX), only computations reading that specific
 * key re-run when it toggles.
 */

import { createStore } from 'solid-js/store';

export type ViewState = ReturnType<typeof createViewState>;

export function createViewState() {
  const [collapsed, setCollapsed] = createStore<Record<string, boolean>>({});

  return {
    isCollapsed: (id: string): boolean => collapsed[id] ?? false,

    toggleCollapsed: (id: string): void => {
      setCollapsed(id, !collapsed[id]);
    },

    setCollapsed: (id: string, value: boolean): void => {
      if (!value) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        setCollapsed(id as keyof typeof collapsed, undefined as unknown as boolean);
      } else {
        setCollapsed(id, true);
      }
    },

    expandAll: (): void => {
      // Replace the entire store with empty to clear all entries
      for (const key of Object.keys(collapsed)) {
        setCollapsed(key as keyof typeof collapsed, undefined as unknown as boolean);
      }
    },
  };
}
