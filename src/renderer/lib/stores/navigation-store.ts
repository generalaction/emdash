import { makeAutoObservable, toJS } from 'mobx';
import type { NavigationSnapshot } from '@shared/view-state';
import { type ViewId, type WrapParams } from '@renderer/app/view-registry';
import { modalStore } from '@renderer/lib/modal/modal-store';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import type { Snapshottable } from './snapshottable';

type ViewParamsStore = Partial<{ [K in ViewId]: WrapParams<K> }>;

export const viewEvents: Record<
  ViewId,
  | 'home_viewed'
  | 'project_viewed'
  | 'task_viewed'
  | 'settings_viewed'
  | 'skills_viewed'
  | 'mcp_viewed'
> = {
  home: 'home_viewed',
  project: 'project_viewed',
  task: 'task_viewed',
  settings: 'settings_viewed',
  skills: 'skills_viewed',
  mcp: 'mcp_viewed',
};

export class NavigationStore implements Snapshottable<NavigationSnapshot> {
  currentViewId: ViewId = 'home';
  viewParamsStore: ViewParamsStore = {};
  isNavigating: boolean = false;

  constructor() {
    makeAutoObservable(this);
  }

  navigate<T extends ViewId>(viewId: T, params?: WrapParams<T>): void {
    if (viewId !== this.currentViewId) {
      const transition = focusTracker.transition(
        viewId === 'task'
          ? { view: viewId }
          : {
              view: viewId,
              mainPanel: null,
              rightPanel: null,
              focusedRegion: null,
            },
        'navigation'
      );
      captureTelemetry(viewEvents[viewId], {
        from_view: transition?.previous.view ?? null,
      });
      this.currentViewId = viewId;
      this.isNavigating = true;
    }
    if (params !== undefined) {
      this.viewParamsStore = { ...this.viewParamsStore, [viewId]: params };
    }
    modalStore.closeModal();
  }

  updateViewParams<TId extends ViewId>(
    viewId: TId,
    update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)
  ): void {
    const current = (this.viewParamsStore[viewId] ?? {}) as WrapParams<TId>;
    const next = typeof update === 'function' ? update(current) : { ...current, ...update };
    this.viewParamsStore = { ...this.viewParamsStore, [viewId]: next };
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
