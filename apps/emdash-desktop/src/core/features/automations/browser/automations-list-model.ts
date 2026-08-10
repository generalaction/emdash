import { createListView, createTextMatcher } from '@emdash/ui/react/patterns';
import type { Automation } from '@core/primitives/automations/api';

/**
 * The list-view state layer for the automations list: sync source fed by a
 * reactive getter (the component wraps query data in an observable box so the
 * pipeline re-derives) plus immediate client-side search over the automation
 * name. Items keep the server's list order — the surface never sorted.
 */
export function createAutomationsListView(getAutomations: () => Automation[]) {
  return createListView({
    getItemId: (automation: Automation) => automation.id,
    source: { kind: 'sync', items: getAutomations },
    search: {
      kind: 'sync',
      predicate: createTextMatcher((automation: Automation) => [automation.name]),
    },
  });
}

export type AutomationsListViewModel = ReturnType<typeof createAutomationsListView>;
