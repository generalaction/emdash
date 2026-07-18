import { commandPaletteModal } from '../browser/command-palette/command-palette-modal';
import { confirmActionModal } from '../browser/confirm-action-dialog';
import { confirmExternalLinkModal } from '../browser/external-link-choice-dialog';
import { feedbackModal } from '../browser/feedback-modal/feedback-modal';
import { homeViewRuntime } from '../browser/home-view';
import { unsavedChangesModal } from '../browser/unsaved-changes-dialog';

export const workbenchBrowserContributions = {
  views: [homeViewRuntime],
  modalDefs: [
    commandPaletteModal,
    confirmActionModal,
    confirmExternalLinkModal,
    unsavedChangesModal,
    feedbackModal,
  ],
} as const;
