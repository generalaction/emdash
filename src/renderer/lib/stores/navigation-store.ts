import { makeAutoObservable, toJS } from 'mobx';
import type { NavigationSnapshot } from '@shared/view-state';
import { ViewId, views, WrapParams } from '@renderer/app/view-registry';
import type { Snapshottable } from './snapshottable';

function isKnownViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(views, value);
}

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
    if (isKnownViewId(snapshot.currentViewId)) this.currentViewId = snapshot.currentViewId;
    if (snapshot.viewParams) this.viewParamsStore = snapshot.viewParams as ViewParamsStore;
  }
}
