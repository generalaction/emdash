import { libraryView } from '../browser/library-view';
import { PromptModal } from '../browser/prompts/prompt-modal';

export const libraryBrowserContributions = {
  views: {
    library: libraryView,
  },
  modals: {
    promptModal: {
      component: PromptModal,
      size: 'lg',
    },
  },
} as const;
