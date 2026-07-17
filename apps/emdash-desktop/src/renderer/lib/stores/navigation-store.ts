import { makeAutoObservable, observable } from 'mobx';
import {
  workbenchNavigationMemento,
  type WorkbenchNavigationState,
} from '@core/features/workbench/contributions/mementos';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import { type GuardResult, type ViewId, type WrapParams } from '@renderer/app/view-registry';
import type { NonSettingsViewId } from '@renderer/lib/layout/navigation-provider';
import { modalStore } from '@renderer/lib/modal/modal-store';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { appState } from './app-state';

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

export class NavigationStore {
  isNavigating: boolean = false;
  lastNonSettingsView: NonSettingsViewId = 'home';
  lastNonLibraryView: NonLibraryViewId = 'home';

  private readonly _guards = new Map<ViewId, (params: unknown) => GuardResult>();
  private readonly _registeredViewIds = new Set<ViewId>();
  private _handle: MementoHandle<WorkbenchNavigationState> | undefined;
  private _fallbackState: WorkbenchNavigationState = workbenchNavigationMemento.default;

  constructor() {
    // `_handle` must stay observable: `state` is a computed, and if it is first
    // evaluated before the memento handle is attached, a non-observable `_handle`
    // would leave the computed with zero dependencies, freezing it at the
    // fallback value forever.
    makeAutoObservable<NavigationStore, '_fallbackState' | '_handle'>(this, {
      _fallbackState: false,
      _handle: observable.ref,
    });
  }

  get currentViewId(): ViewId {
    return this.state.currentViewId as ViewId;
  }

  get viewParamsStore(): ViewParamsStore {
    return this.state.viewParams as ViewParamsStore;
  }

  attachMemento(handle: MementoHandle<WorkbenchNavigationState>): void {
    if (this._handle) throw new Error('Navigation memento is already attached');
    this._handle = handle;
    const normalized = this.normalizeState(handle.value);
    if (!sameNavigationState(normalized, handle.value)) handle.update(normalized);
    this.updateLastVisitedViews(normalized.currentViewId as ViewId);
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
      this.updateLastVisitedViews(viewId);
      this.isNavigating = true;
    }
    this.updateState((current) => ({
      ...current,
      currentViewId: viewId,
      viewParams:
        params === undefined ? current.viewParams : { ...current.viewParams, [viewId]: params },
    }));
    modalStore.closeModal();
  }

  updateViewParams<TId extends ViewId>(
    viewId: TId,
    update: Partial<WrapParams<TId>> | ((prev: WrapParams<TId>) => WrapParams<TId>)
  ): void {
    const current = (this.viewParamsStore[viewId] ?? {}) as WrapParams<TId>;
    const next = typeof update === 'function' ? update(current) : { ...current, ...update };
    this.updateState((state) => ({
      ...state,
      viewParams: { ...state.viewParams, [viewId]: next },
    }));
  }

  private get state(): WorkbenchNavigationState {
    return this._handle?.value ?? this._fallbackState;
  }

  private updateState(
    update: (current: WorkbenchNavigationState) => WorkbenchNavigationState
  ): void {
    if (this._handle) {
      this._handle.update(update);
    } else {
      this._fallbackState = update(this._fallbackState);
    }
  }

  private normalizeState(state: WorkbenchNavigationState): WorkbenchNavigationState {
    const viewParams: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(state.viewParams)) {
      if (this.isRegisteredViewId(key)) viewParams[key] = value;
    }
    let currentViewId = this.isRegisteredViewId(state.currentViewId)
      ? state.currentViewId
      : ('home' as ViewId);
    const guard = this._runGuard(currentViewId, viewParams[currentViewId]);
    if (!guard.ok) {
      currentViewId = guard.redirect;
      if (guard.params !== undefined) viewParams[guard.redirect] = guard.params;
    }
    return { ...state, currentViewId, viewParams };
  }

  private updateLastVisitedViews(viewId: ViewId): void {
    if (viewId !== 'settings') this.lastNonSettingsView = viewId as NonSettingsViewId;
    if (!isLibraryView(viewId)) this.lastNonLibraryView = viewId;
  }
}

function sameNavigationState(
  left: WorkbenchNavigationState,
  right: WorkbenchNavigationState
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
