import { z } from 'zod';
import { defineCommand } from '@core/primitives/commands/api';
import { code, keybinding } from '@core/primitives/keybindings/api';

export const settingsCommand = defineCommand({
  id: 'app.settings',
  title: 'Open Settings',
  description: 'Open application settings',
  category: 'App',
  icon: 'settings',
  keybinding: keybinding.settings('settings', 'Mod+,'),
});

export const libraryCommand = defineCommand({
  id: 'app.library',
  title: 'Open Library',
  description: 'Open the Library',
  category: 'App',
  icon: 'library',
  keybinding: keybinding.settings('library', 'Mod+L'),
});

export const newProjectCommand = defineCommand({
  id: 'app.newProject',
  title: 'New Project',
  description: 'Add a new local or SSH project',
  category: 'App',
  icon: 'folder-plus',
  keybinding: keybinding.settings('newProject', 'Mod+Shift+N'),
});

export const newTaskCommand = defineCommand({
  id: 'app.newTask',
  title: 'New Task',
  description: 'Create a new task in this project',
  category: 'App',
  icon: 'square-plus',
  // Keybindings invoke without input; contextual callers may supply a project.
  input: z.object({ projectId: z.string().optional() }).optional(),
  keybinding: keybinding.settings('newTask', 'Mod+N'),
});

export const giveFeedbackCommand = defineCommand({
  id: 'app.giveFeedback',
  title: 'Give Feedback',
  description: 'Send feedback to the emdash team',
  category: 'App',
  icon: 'message-square-share',
});

export const toggleThemeCommand = defineCommand({
  id: 'app.toggleTheme',
  title: 'Toggle Theme',
  description: 'Switch between light and dark themes',
  category: 'View',
  icon: 'palette',
});

export const navigateBackCommand = defineCommand({
  id: 'app.navigateBack',
  title: 'Go Back',
  description: 'Navigate to the previous location',
  category: 'Navigation',
  icon: 'arrow-left',
  keybinding: keybinding.settings('navigateBack', code(['Mod'], 'BracketLeft')),
});

export const navigateForwardCommand = defineCommand({
  id: 'app.navigateForward',
  title: 'Go Forward',
  description: 'Navigate to the next location',
  category: 'Navigation',
  icon: 'arrow-right',
  keybinding: keybinding.settings('navigateForward', code(['Mod'], 'BracketRight')),
});

export const commandPaletteCommand = defineCommand({
  id: 'app.commandPalette',
  title: 'Command Palette',
  description: 'Open the command palette to quickly search and navigate',
  category: 'Navigation',
  keybinding: keybinding.settings('commandPalette', 'Mod+K'),
});

export const openInEditorCommand = defineCommand({
  id: 'app.openInEditor',
  title: 'Open in Editor',
  description: 'Open the project in the default editor',
  category: 'Navigation',
  keybinding: keybinding.settings('openInEditor', 'Mod+O'),
});

export const toggleLeftSidebarCommand = defineCommand({
  id: 'workbench.toggleLeftSidebar',
  title: 'Toggle Left Sidebar',
  description: 'Show or hide the left sidebar',
  category: 'View',
  keybinding: keybinding.settings('toggleLeftSidebar', 'Mod+B'),
});

export const zenModeCommand = defineCommand({
  id: 'workbench.zenMode',
  title: 'Zen Mode',
  description: 'Hide both sidebars',
  category: 'View',
  keybinding: keybinding.settings('zenMode', 'Control+Z', {
    ignoreWhenTextInputFocused: true,
  }),
});

export const WORKBENCH_COMMAND_DEFS = [
  settingsCommand,
  libraryCommand,
  newProjectCommand,
  newTaskCommand,
  giveFeedbackCommand,
  toggleThemeCommand,
  navigateBackCommand,
  navigateForwardCommand,
  commandPaletteCommand,
  openInEditorCommand,
  toggleLeftSidebarCommand,
  zenModeCommand,
] as const;
