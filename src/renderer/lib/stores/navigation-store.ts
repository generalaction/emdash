import { makeAutoObservable, toJS } from 'mobx';
import { type GuardResult, type ViewId, type WrapParams } from '@renderer/app/view-registry';
import type { NonSettingsViewId } from '@renderer/lib/layout/navigation-provider';
import { modalStore } from '@renderer/lib/modal/modal-store';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import type { NavigationSnapshot } from '@shared/view-state';
import { appState } from './app-state';
import type { Snapshottable } from './snapshottable';

type ViewParamsStore = Partial<{ [K in ViewId]: WrapParams<K> }>;

export const viewEvents: Record<
  ViewId,
  | 'home_viewed'
  | 'project_viewed'
  | 'task_viewed'
  | 'settings_viewed'
  | 'library_viewed'
  | 'skills_viewed'
  | 'mcp_viewed'
  | 'automations_viewed'
> = {
  home: 'home_viewed',
  automations: 'automations_viewed',
  library: 'library_viewed',
  project: 'project_viewed',
  task: 'task_viewed',
  settings: 'settings_viewed',
  skills: 'skills_viewed',
  mcp: 'mcp_viewed',
};

type LibraryViewId = 'library' | 'skills' | 'mcp';
type NonLibraryViewId = Exclude<ViewId, LibraryViewId>;

function isLibraryView(viewId: ViewId): viewId is LibraryViewId {
  return viewId === 'library' || viewId === 'skills' || viewId === 'mcp';
}

export class NavigationStore implements Snapshottable<NavigationSnapshot> {
  currentViewId: ViewId = 'home';
  viewParamsStore: ViewParamsStore = {};
  isNavigating: boolean = false;
  lastNonSettingsView: NonSettingsViewId = 'home';
  lastNonLibraryView: NonLibraryViewId = 'home';

  private readonly _guards = new Map<ViewId, (params: unknown) => GuardResult>();
  private readonly _registeredViewIds = new Set<ViewId>();

  constructor() {
    makeAutoObservable(this);
  }

  registerView(viewId: ViewId): void {
    this._registeredViewIds.add(viewId);
  }

  isRegisteredViewId(value: unknown): value is ViewId {
    return typeof value === 'string' && this._registeredViewIds.has(value as ViewId);
  }

  registerGuard(viewId: ViewId, guard: (params: unknown) => GuardResult): void {
    this._guards.set(viewId, guard);
  }

  private _runGuard(viewId: ViewId, params: unknown): GuardResult {
    return this._guards.get(viewId)?.(params) ?? { ok: true };
  }

  revalidate(): void {
    const result = this._runGuard(this.currentViewId, this.viewParamsStore[this.currentViewId]);
    if (!result.ok) this._applyNavigation(result.redirect, result.params as WrapParams<ViewId>);
  }

  navigate<T extends ViewId>(viewId: T, params?: WrapParams<T>): void {
    if (viewId !== 'task') {
      const historyParams = params ?? this.viewParamsStore[viewId] ?? ({} as WrapParams<T>);
      appState.history.push({ kind: 'view', viewId, params: historyParams });
    }
    this._applyNavigation(viewId, params);
  }

  _applyNavigation<T extends ViewId>(viewId: T, params?: WrapParams<T>): void {
    const resolvedParams = params ?? this.viewParamsStore[viewId];
    const guard = this._runGuard(viewId, resolvedParams);
    if (!guard.ok) {
      this._applyNavigation(guard.redirect, guard.params as WrapParams<typeof guard.redirect>);
      return;
    }

    if (viewId !== this.currentViewId) {
      const transition = focusTracker.transition(
        viewId === 'task'
          ? { view: viewId }
          : {
              view: viewId,
              mainPanel: null,
              focusedRegion: null,
            },
        'navigation'
      );
      captureTelemetry(viewEvents[viewId], {
        from_view: transition?.previous.view ?? null,
      });
      this.currentViewId = viewId;
      if (viewId !== 'settings') {
        this.lastNonSettingsView = viewId;
      }
      if (!isLibraryView(viewId)) {
        this.lastNonLibraryView = viewId;
      }
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
    if (this.isRegisteredViewId(snapshot.currentViewId)) {
      this.currentViewId = snapshot.currentViewId;
      if (snapshot.currentViewId !== 'settings') {
        this.lastNonSettingsView = snapshot.currentViewId as NonSettingsViewId;
      }
      if (!isLibraryView(snapshot.currentViewId)) {
        this.lastNonLibraryView = snapshot.currentViewId;
      }
    }
    if (snapshot.viewParams) {
      const filtered: ViewParamsStore = {};
      for (const [key, value] of Object.entries(snapshot.viewParams)) {
        if (this.isRegisteredViewId(key)) {
          (filtered as Record<ViewId, unknown>)[key] = value;
        }
      }
      this.viewParamsStore = filtered;
    }

    // Validate after params are loaded so the guard has full context.
    const guard = this._runGuard(this.currentViewId, this.viewParamsStore[this.currentViewId]);
    if (!guard.ok) {
      this.currentViewId = guard.redirect;
      if (guard.redirect !== 'settings') {
        this.lastNonSettingsView = guard.redirect as NonSettingsViewId;
      }
      if (!isLibraryView(guard.redirect)) {
        this.lastNonLibraryView = guard.redirect;
      }
      if (guard.params !== undefined) {
        this.viewParamsStore = { ...this.viewParamsStore, [guard.redirect]: guard.params };
      }
    }
  }
}
