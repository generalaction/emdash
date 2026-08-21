import { commitDetailsModal } from '../browser/diff-view/changes-panel/components/pr-entry/commit-details-modal';
import { createPrModal } from '../browser/diff-view/changes-panel/components/pr-entry/create-pr-modal';

export const sourceControlBrowserContributions = {
  modalDefs: [commitDetailsModal, createPrModal],
} as const;
