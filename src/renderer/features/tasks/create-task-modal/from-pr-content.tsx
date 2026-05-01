import { CheckoutModeGroup } from './checkout-mode-group';
import {
  InitialConversationField,
  type InitialConversationState,
} from './initial-conversation-section';
import { PrPickerField } from './pr-picker-field';
import { TaskNameField } from './task-name-field';
import type { FromPullRequestModeState } from './use-from-pull-request-mode';

interface FromPrContentProps {
  state: FromPullRequestModeState;
  projectId?: string;
  repositoryUrl?: string;
  disabled?: boolean;
  initialConversation?: InitialConversationState;
  connectionId?: string;
}

export function FromPrContent({
  state,
  projectId,
  repositoryUrl,
  disabled,
  initialConversation,
  connectionId,
}: FromPrContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <PrPickerField
        state={state}
        projectId={projectId}
        repositoryUrl={repositoryUrl}
        disabled={disabled}
      />
      <CheckoutModeGroup
        value={state.checkoutMode}
        onValueChange={state.setCheckoutMode}
        pushBranch={state.branchSelection.pushBranch}
        onPushBranchChange={state.branchSelection.setPushBranch}
        disabled={disabled}
      />
      <TaskNameField state={state} />
      {initialConversation && (
        <InitialConversationField state={initialConversation} connectionId={connectionId} />
      )}
    </div>
  );
}
