import type { ComponentType } from 'react';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { DialogDescription, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import AsanaSetupForm from './AsanaSetupForm';
import FeaturebaseSetupForm from './FeaturebaseSetupForm';
import ForgejoSetupForm from './ForgejoSetupForm';
import GitLabSetupForm from './GitLabSetupForm';
import { ISSUE_PROVIDER_META, SETUP_PROVIDER_META } from './issue-provider-meta';
import JiraSetupForm from './JiraSetupForm';
import LinearSetupForm from './LinearSetupForm';
import MondaySetupForm from './MondaySetupForm';
import NotionSetupForm from './NotionSetupForm';
import PlainSetupForm from './PlainSetupForm';
import PlaneSetupForm from './PlaneSetupForm';
import { type SetupFormProps } from './SetupFormShell';
import TrelloSetupForm from './TrelloSetupForm';
import type { SetupIntegrationType } from './types';

type IntegrationSetupModalArgs = {
  integration: SetupIntegrationType;
  mode?: 'connect' | 'edit';
};

type Props = BaseModalProps<void> & IntegrationSetupModalArgs;

const SETUP_FORMS: Record<SetupIntegrationType, ComponentType<SetupFormProps>> = {
  linear: LinearSetupForm,
  jira: JiraSetupForm,
  gitlab: GitLabSetupForm,
  plane: PlaneSetupForm,
  plain: PlainSetupForm,
  forgejo: ForgejoSetupForm,
  featurebase: FeaturebaseSetupForm,
  asana: AsanaSetupForm,
  monday: MondaySetupForm,
  trello: TrelloSetupForm,
  notion: NotionSetupForm,
};

export function IntegrationSetupModal({
  integration,
  mode = 'connect',
  onSuccess,
  onClose,
}: Props) {
  const { title, subtitle } = SETUP_PROVIDER_META[integration];
  const Form = SETUP_FORMS[integration];
  const isEditing = mode === 'edit';
  const modalTitle = isEditing ? `Edit ${ISSUE_PROVIDER_META[integration].displayName}` : title;
  const modalSubtitle = isEditing
    ? 'Update the saved integration settings. Leave the access token blank to keep the current one.'
    : subtitle;

  return (
    <>
      <DialogHeader className="flex-col items-start gap-1" showCloseButton={false}>
        <DialogTitle>{modalTitle}</DialogTitle>
        <DialogDescription className="text-xs">{modalSubtitle}</DialogDescription>
      </DialogHeader>
      <Form onSuccess={onSuccess} onClose={onClose} />
    </>
  );
}
