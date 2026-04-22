import { makeAutoObservable, toJS } from 'mobx';
import type { NavigationSnapshot } from '@shared/view-state';
import { ViewId, WrapParams } from '@renderer/app/view-registry';
import type { Snapshottable } from './snapshottable';

type ViewParamsStore = Partial<{ [K in ViewId]: WrapParams<K> }>;

export class NavigationStore implements Snapshottable<NavigationSnapshot> {
  currentViewId: ViewId = 'home';
  viewParamsStore: ViewParamsStore = {};

  constructor() {
    makeAutoObservable(this);
  }

  sync(viewId: ViewId, paramsStore: ViewParamsStore): void {
    this.currentViewId = viewId;
    this.viewParamsStore = paramsStore;
  }

  get snapshot(): NavigationSnapshot {
    return {
      currentViewId: this.currentViewId,
      viewParams: toJS(this.viewParamsStore) as Record<string, unknown>,
    };
  }

  restoreSnapshot(snapshot: Partial<NavigationSnapshot>): void {
    if (snapshot.currentViewId) this.currentViewId = snapshot.currentViewId as ViewId;
    if (snapshot.viewParams) this.viewParamsStore = snapshot.viewParams as ViewParamsStore;
  }
}
