import { featureModalContributions } from '@core/manifests/browser-contributions';
import { AddSshConnModal } from '@renderer/lib/components/add-ssh-conn-modal';
import { ChangeProjectConnectionModal } from '@renderer/lib/components/change-project-connection-modal';
import { ConfirmActionDialog } from '@renderer/lib/components/confirm-action-dialog';
import { ExternalLinkChoiceDialog } from '@renderer/lib/components/external-link-choice-dialog';
import { FeedbackModal } from '@renderer/lib/components/feedback-modal/feedback-modal';
import { GithubDeviceFlowModal } from '@renderer/lib/components/github-device-flow-modal';
import { UnsavedChangesDialog } from '@renderer/lib/components/unsaved-changes-dialog';
import { type ModalComponent } from '@renderer/lib/modal/modal-provider';

export type ModalSize = 'xs' | 'sm' | 'md' | 'lg';
export type ModalPosition = 'center' | 'top';

export type ModalRegistryEntry<TProps = unknown, TResult = unknown> = {
  component: ModalComponent<TProps, TResult>;
  size?: ModalSize;
  position?: ModalPosition;
  ignoreOutsidePressAfterWindowBlur?: boolean;
};

export function createModal<TProps, TResult>(
  component: ModalComponent<TProps, TResult>,
  config: Omit<ModalRegistryEntry, 'component'> = {}
): ModalRegistryEntry<TProps, TResult> {
  return { component, ...config };
}

export const modalRegistry = {
  addSshConnModal: createModal(AddSshConnModal),
  changeProjectConnectionModal: createModal(ChangeProjectConnectionModal, { size: 'sm' }),
  githubDeviceFlowModal: createModal(GithubDeviceFlowModal, { size: 'md' }),
  confirmActionModal: createModal(ConfirmActionDialog, { size: 'xs' }),
  confirmExternalLinkModal: createModal(ExternalLinkChoiceDialog, { size: 'sm' }),
  unsavedChangesModal: createModal(UnsavedChangesDialog, { size: 'xs' }),
  feedbackModal: createModal(FeedbackModal),
  ...featureModalContributions,
  // oxlint-disable-next-line typescript/no-explicit-any
} satisfies Record<string, ModalRegistryEntry<any, any>>;
