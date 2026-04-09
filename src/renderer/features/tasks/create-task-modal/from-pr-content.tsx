import { CheckoutModeGroup } from './checkout-mode-group';
import { PrPickerField } from './pr-picker-field';
import { TaskNameField } from './task-name-field';
import { FromPullRequestModeState } from './use-from-pull-request-mode';

interface FromPrContentProps {
  state: FromPullRequestModeState;
  projectId?: string;
  nameWithOwner?: string;
  disabled?: boolean;
}

export function FromPrContent({ state, projectId, nameWithOwner, disabled }: FromPrContentProps) {
  return (
    <div className="flex flex-col gap-4">
      <PrPickerField
        state={state}
        projectId={projectId}
        nameWithOwner={nameWithOwner}
        disabled={disabled}
      />
      <CheckoutModeGroup value={state.checkoutMode} onValueChange={state.setCheckoutMode} />
      <TaskNameField state={state} />
    </div>
  );
}
