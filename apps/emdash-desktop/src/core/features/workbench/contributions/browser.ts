import { CommandPaletteModal } from '../browser/command-palette/command-palette-modal';
import { homeViewRuntime } from '../browser/home-view';

export const workbenchBrowserContributions = {
  views: [homeViewRuntime],
  modals: {
    commandPaletteModal: {
      component: CommandPaletteModal,
      size: 'md',
    },
  },
} as const;
