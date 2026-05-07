import { showModal } from '@renderer/lib/modal/modal-provider';
import { appState } from '@renderer/lib/stores/app-state';
import { commandRegistry } from './registry';
import type { AppCommand, CommandProvider } from './types';

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

      const commands: AppCommand[] = [
        {
          id: 'app.settings',
          label: 'Open Settings',
          description: 'Open application settings',
          shortcutKey: 'settings',
          group: 'App',
          execute() {
            appState.navigation.navigate('settings');
          },
        },
        {
          id: 'app.newProject',
          label: 'New Project',
          description: 'Add a new local or SSH project',
          shortcutKey: 'newProject',
          group: 'App',
          execute() {
            showModal('addProjectModal', { strategy: 'local', mode: 'pick' });
          },
        },
      ];

      if (projectId) {
        commands.push({
          id: 'app.newTask',
          label: 'New Task',
          description: 'Create a new task in this project',
          shortcutKey: 'newTask',
          group: 'App',
          execute() {
            showModal('taskModal', { projectId });
          },
        });
      }

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
