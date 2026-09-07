import { observable, runInAction } from 'mobx';
import { describe, expect, it } from 'vitest';
import type { Automation } from '@core/primitives/automations/api';
import { createAutomationsListView } from './automations-list-model';

describe('createAutomationsListView', () => {
  it('keeps source order and searches by name', () => {
    const view = createAutomationsListView({
      kind: 'sync',
      items: [automation('b', 'Nightly triage'), automation('a', 'Changelog digest')],
    });
    const search = (query: string) => {
      view.store.search!.setQuery(query);
      return view.store.orderedIds;
    };

    expect(search('')).toEqual(['b', 'a']);
    expect(search('triage')).toEqual(['b']);
    expect(search('CHANGELOG')).toEqual(['a']);
    expect(search('nothing')).toEqual([]);
  });

  it('re-derives when the observable source changes', () => {
    const box = observable.box<Automation[]>([], { deep: false });
    const view = createAutomationsListView({ kind: 'sync', items: () => box.get() });

    expect(view.store.orderedIds).toEqual([]);
    runInAction(() => box.set([automation('a', 'Nightly triage')]));
    expect(view.store.orderedIds).toEqual(['a']);
  });
});

function automation(id: string, name: string): Automation {
  return {
    id,
    name,
    enabled: true,
    projectId: 'project-1',
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}
