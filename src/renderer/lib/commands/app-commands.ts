import { APP_COMMAND_DEFS, type AppCommandId, type CommandDef } from '@shared/commands';
import { applyHistoryEntry } from '@renderer/lib/components/nav-buttons';
import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { commandRegistry } from './registry';
import type { AppCommand, CommandProvider } from './types';

function appDef(id: AppCommandId): CommandDef {
  return APP_COMMAND_DEFS.find((d) => d.id === id)!;
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
      const newProjectDef = appDef('app.newProject');
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
            appState.navigation.navigate('settings');
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
