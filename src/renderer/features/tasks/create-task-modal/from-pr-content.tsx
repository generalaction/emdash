import { CheckoutModeGroup } from './checkout-mode-group';
import { type InitialConversationState, InitialConversationField } from './initial-conversation-section';
import { PrPickerField } from './pr-picker-field';
import { TaskNameField } from './task-name-field';
import { FromPullRequestModeState } from './use-from-pull-request-mode';

interface FromPrContentProps {
  state: FromPullRequestModeState;
  projectId?: string;
  nameWithOwner?: string;
  disabled?: boolean;
  initialConversation: InitialConversationState;
  connectionId?: string;
}

export function FromPrContent({
  state,
  projectId,
  nameWithOwner,
  disabled,
  initialConversation,
  connectionId,
}: FromPrContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <PrPickerField
        state={state}
        projectId={projectId}
        repositoryUrl={nameWithOwner}
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
      <InitialConversationField state={initialConversation} connectionId={connectionId} />
    </div>
  );
}
