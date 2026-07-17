import { libraryViewRuntime } from '../browser/library-view';
import { PromptModal } from '../browser/prompts/prompt-modal';

export const libraryBrowserContributions = {
  views: [libraryViewRuntime],
  modals: {
    promptModal: {
      component: PromptModal,
      size: 'lg',
    },
  },
} as const;
