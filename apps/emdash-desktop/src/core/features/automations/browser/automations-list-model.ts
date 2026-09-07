import { createListView, createTextMatcher, type ListSource } from '@emdash/ui/react/patterns';
import type { Automation } from '@core/primitives/automations/api';

/**
 * The list-view state layer for the automations list: an externally owned
 * source (the component bridges its query via `useQueryListSource`) plus
 * immediate client-side search over the automation name. Items keep the
 * server's list order — the surface never sorted.
 */
export function createAutomationsListView(source: ListSource<Automation>) {
  return createListView({
    getItemId: (automation: Automation) => automation.id,
    source,
    search: {
      kind: 'sync',
      predicate: createTextMatcher((automation: Automation) => [automation.name]),
    },
  });
}

export type AutomationsListViewModel = ReturnType<typeof createAutomationsListView>;
