import { applyHistoryEntry } from '@renderer/lib/components/nav-buttons';
import { toast } from '@renderer/lib/hooks/use-toast';
import { toggleSettingsView } from '@renderer/lib/layout/settings-toggle';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { toggleAppTheme } from '@renderer/lib/theme/theme-toggle';
import { APP_COMMAND_DEFS, type AppCommandId, type CommandDef } from '@shared/commands';
import { commandRegistry } from './registry';
import type { AppCommand, CommandProvider } from './types';

function appDef(id: AppCommandId): CommandDef {
  return APP_COMMAND_DEFS.find((d) => d.id === id)!;
}

function isLibraryView(viewId: string): boolean {
  return viewId === 'library' || viewId === 'skills' || viewId === 'mcp';
}

function createAppCommandProvider(): CommandProvider {
  return {
    scopeId: 'app',

    getCommands(): AppCommand[] {
      // Reads MobX observables — reactions automatically invalidate activeCommands
      // when navigation changes.
      const viewId = appState.navigation.currentViewId;
      const params = appState.navigation.viewParamsStore[viewId] as
        | { projectId?: string }
        | undefined;
      const projectId = params?.projectId;

      const settingsDef = appDef('app.settings');
      const libraryDef = appDef('app.library');
      const newProjectDef = appDef('app.newProject');
      const giveFeedbackDef = appDef('app.giveFeedback');
      const toggleThemeDef = appDef('app.toggleTheme');
      const navigateBackDef = appDef('app.navigateBack');
      const navigateForwardDef = appDef('app.navigateForward');

      const commands: AppCommand[] = [
        {
          id: settingsDef.id,
          label: settingsDef.label,
          description: settingsDef.description,
          shortcutKey: settingsDef.shortcutKey,
          group: settingsDef.group,
          execute() {
            toggleSettingsView(
              appState.navigation.navigate.bind(appState.navigation),
              appState.navigation.currentViewId,
              appState.navigation.lastNonSettingsView
            );
          },
        },
        {
          id: libraryDef.id,
          label: libraryDef.label,
          description: libraryDef.description,
          shortcutKey: libraryDef.shortcutKey,
          group: libraryDef.group,
          execute() {
            if (isLibraryView(appState.navigation.currentViewId)) {
              appState.navigation.navigate(appState.navigation.lastNonLibraryView);
              return;
            }

            appState.navigation.navigate('library');
          },
        },
        {
          id: newProjectDef.id,
          label: newProjectDef.label,
          description: newProjectDef.description,
          shortcutKey: newProjectDef.shortcutKey,
          group: newProjectDef.group,
          execute() {
            showModal('addProjectModal', { strategy: 'local', mode: 'pick' });
          },
        },
      ];

      commands.push({
        id: giveFeedbackDef.id,
        label: giveFeedbackDef.label,
        description: giveFeedbackDef.description,
        shortcutKey: giveFeedbackDef.shortcutKey,
        group: giveFeedbackDef.group,
        execute() {
          showModal('feedbackModal', {});
        },
      });

      commands.push({
        id: toggleThemeDef.id,
        label: toggleThemeDef.label,
        description: toggleThemeDef.description,
        shortcutKey: toggleThemeDef.shortcutKey,
        group: toggleThemeDef.group,
        execute() {
          void toggleAppTheme().then((result) => {
            if (result.success) return;
            toast({
              title: 'Theme not changed',
              description: result.error.message,
              variant: 'destructive',
            });
          });
        },
      });

      if (projectId) {
        const newTaskDef = appDef('app.newTask');
        commands.push({
          id: newTaskDef.id,
          label: newTaskDef.label,
          description: newTaskDef.description,
          shortcutKey: newTaskDef.shortcutKey,
          group: newTaskDef.group,
          execute() {
            showModal('taskModal', { projectId });
          },
        });
      }

      commands.push(
        {
          id: navigateBackDef.id,
          label: navigateBackDef.label,
          description: navigateBackDef.description,
          shortcutKey: navigateBackDef.shortcutKey,
          group: navigateBackDef.group,
          enabled: appState.history.canGoBack,
          hideFromPalette: true,
          execute() {
            appState.history.back(applyHistoryEntry);
          },
        },
        {
          id: navigateForwardDef.id,
          label: navigateForwardDef.label,
          description: navigateForwardDef.description,
          shortcutKey: navigateForwardDef.shortcutKey,
          group: navigateForwardDef.group,
          enabled: appState.history.canGoForward,
          hideFromPalette: true,
          execute() {
            appState.history.forward(applyHistoryEntry);
          },
        }
      );

      return commands;
    },
  };
}

/**
 * Registers the app-scope CommandProvider. Must be called once at startup.
 * The provider is permanent — it reacts to navigation changes via MobX
 * observables inside getCommands().
 */
export function setupAppCommandProvider(): void {
  commandRegistry.register(createAppCommandProvider());
}
