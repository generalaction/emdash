import type { ComponentType } from 'react';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { DialogDescription, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import AsanaSetupForm from './AsanaSetupForm';
import FeaturebaseSetupForm from './FeaturebaseSetupForm';
import ForgejoSetupForm from './ForgejoSetupForm';
import GitLabSetupForm from './GitLabSetupForm';
import { SETUP_PROVIDER_META } from './issue-provider-meta';
import JiraSetupForm from './JiraSetupForm';
import LinearSetupForm from './LinearSetupForm';
import MondaySetupForm from './MondaySetupForm';
import PlainSetupForm from './PlainSetupForm';
import { type SetupFormProps } from './SetupFormShell';
import TrelloSetupForm from './TrelloSetupForm';
import type { SetupIntegrationType } from './types';

type IntegrationSetupModalArgs = {
  integration: SetupIntegrationType;
};

type Props = BaseModalProps<void> & IntegrationSetupModalArgs;

const SETUP_FORMS: Record<SetupIntegrationType, ComponentType<SetupFormProps>> = {
  linear: LinearSetupForm,
  jira: JiraSetupForm,
  gitlab: GitLabSetupForm,
  plain: PlainSetupForm,
  forgejo: ForgejoSetupForm,
  featurebase: FeaturebaseSetupForm,
  asana: AsanaSetupForm,
  monday: MondaySetupForm,
  trello: TrelloSetupForm,
};

export function IntegrationSetupModal({ integration, onSuccess, onClose }: Props) {
  const { title, subtitle } = SETUP_PROVIDER_META[integration];
  const Form = SETUP_FORMS[integration];

  return (
    <>
      <DialogHeader className="flex-col items-start gap-1" showCloseButton={false}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="text-xs">{subtitle}</DialogDescription>
      </DialogHeader>
      <Form onSuccess={onSuccess} onClose={onClose} />
    </>
  );
}
