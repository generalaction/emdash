import type { ComponentType, ReactNode } from 'react';
import { homeView } from '@renderer/app/home-view';
import { libraryView } from '@renderer/features/library/library-view';
import { mcpView } from '@renderer/features/mcp/mcp-view';
import { projectView } from '@renderer/features/projects/view';
import { settingsView } from '@renderer/features/settings/settings-view';
import { skillsView } from '@renderer/features/skills/skills-view';
import { taskView } from '@renderer/features/tasks/view';
import type { CommandProvider } from '@renderer/lib/commands/types';
import { appState } from '@renderer/lib/stores/app-state';

// Define views here so we can use them in the navigate function
export const views = {
  home: homeView,
  library: libraryView,
  skills: skillsView,
  mcp: mcpView,
  project: projectView,
  task: taskView,
  settings: settingsView,
  // oxlint-disable-next-line typescript/no-explicit-any
} satisfies Record<string, ViewDefinition<any>>;

export type ViewDefinition<TParams extends object = Record<never, never>> = {
  WrapView?: ComponentType<{ children: ReactNode } & TParams>;
  TitlebarSlot?: ComponentType;
  MainPanel: ComponentType;
  /**
   * Factory called by Workspace whenever this view becomes active.
   * The returned CommandProvider is registered in commandRegistry and
   * unregistered when the view changes or the params change.
   */
  commandProvider?: (params: TParams) => CommandProvider;
  /**
   * Called before navigation to this view is committed. Return { ok: false }
   * to redirect to a different view instead.
   *
   * Receives `unknown` because params can come from persisted snapshots written
   * by older builds, so each guard must validate the shape before using it.
   */
  canActivate?: (params: unknown) => GuardResult;
};

type Views = typeof views;

export type ViewId = keyof Views;

export type WrapParams<TId extends ViewId> = Views[TId] extends {
  WrapView: ComponentType<infer P>;
}
  ? Omit<P, 'children'>
  : Record<never, never>;

export type GuardResult =
  | { ok: true }
  | { ok: false; redirect: ViewId; params?: Record<string, unknown> };

export function setupNavigationGuards(): void {
  for (const [viewId, view] of Object.entries(views) as Array<
    [ViewId, ViewDefinition<Record<string, unknown>>]
  >) {
    appState.navigation.registerView(viewId);
    if (view.canActivate) {
      appState.navigation.registerGuard(viewId, view.canActivate);
    }
  }
}
