import { commandPaletteModal } from '../browser/command-palette/command-palette-modal';
import { confirmActionModal } from '../browser/confirm-action-dialog';
import { confirmExternalLinkModal } from '../browser/external-link-choice-dialog';
import { feedbackModal } from '../browser/feedback-modal/feedback-modal';
import { homeViewRuntime } from '../browser/home-view';
import { quitUnsavedChangesModal } from '../browser/quit-unsaved-changes-dialog';
import { unsavedChangesModal } from '../browser/unsaved-changes-dialog';
import { waitlistModal } from '../browser/waitlist/waitlist-modal';

export const workbenchBrowserContributions = {
  views: [homeViewRuntime],
  modalDefs: [
    commandPaletteModal,
    confirmActionModal,
    confirmExternalLinkModal,
    quitUnsavedChangesModal,
    unsavedChangesModal,
    feedbackModal,
    waitlistModal,
  ],
} as const;
