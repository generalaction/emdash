import { libraryViewRuntime } from '../browser/library-view';
import { promptModal } from '../browser/prompts/prompt-modal';

export const libraryBrowserContributions = {
  views: [libraryViewRuntime],
  modalDefs: [promptModal],
} as const;
