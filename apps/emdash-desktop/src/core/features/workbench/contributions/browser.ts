import { CommandPaletteModal } from '../browser/command-palette/command-palette-modal';

export const workbenchBrowserContributions = {
  modals: {
    commandPaletteModal: {
      component: CommandPaletteModal,
      size: 'md',
    },
  },
} as const;
