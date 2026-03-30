import { useState } from 'react';
import { InlinePrSelector } from '@renderer/components/inline-pr-selector';
import { SelectedPrCard } from './selected-pr-card';
import { FromPullRequestModeState } from './use-from-pull-request-mode';

interface PrPickerFieldProps {
  state: FromPullRequestModeState;
  projectId?: string;
  nameWithOwner?: string;
  disabled?: boolean;
}

export function PrPickerField({ state, projectId, nameWithOwner, disabled }: PrPickerFieldProps) {
  const [isSelecting, setIsSelecting] = useState(!state.linkedPR);

  const handleValueChange = (pr: Parameters<typeof state.setLinkedPR>[0]) => {
    state.setLinkedPR(pr);
    if (pr) setIsSelecting(false);
  };

  const handleDeselect = () => {
    state.setLinkedPR(null);
    setIsSelecting(true);
  };

  if (isSelecting || !state.linkedPR) {
    return (
      <InlinePrSelector
        value={state.linkedPR}
        onValueChange={handleValueChange}
        projectId={projectId}
        nameWithOwner={nameWithOwner}
        disabled={disabled}
      />
    );
  }

  return <SelectedPrCard pr={state.linkedPR} onDeselect={handleDeselect} />;
}
