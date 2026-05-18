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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
   */
  canActivate?: (params: TParams) => GuardResult;
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
    [string, ViewDefinition<Record<string, unknown>>]
  >) {
    if (view.canActivate) {
      appState.navigation.registerGuard(
        viewId as ViewId,
        view.canActivate as (params: unknown) => GuardResult
      );
    }
  }
}
