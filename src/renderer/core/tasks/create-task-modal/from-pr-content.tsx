import { GitBranch, GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { InlinePrSelector } from '@renderer/components/inline-pr-selector';
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group';
import { TaskNameField } from './task-name-field';
import { CheckoutMode, FromPullRequestModeState } from './use-from-pull-request-mode';

interface FromPrContentProps {
  state: FromPullRequestModeState;
  nameWithOwner?: string;
  disabled?: boolean;
}

export function FromPrContent({ state, nameWithOwner, disabled }: FromPrContentProps) {
  const [isSelecting, setIsSelecting] = useState(!state.linkedPR);

  const handleValueChange = (pr: Parameters<typeof state.setLinkedPR>[0]) => {
    state.setLinkedPR(pr);
    if (pr) setIsSelecting(false);
  };

  const handleDeselect = () => {
    state.setLinkedPR(null);
    setIsSelecting(true);
  };

  return (
    <div className="flex flex-col gap-4">
      {isSelecting || !state.linkedPR ? (
        <InlinePrSelector
          value={state.linkedPR}
          onValueChange={handleValueChange}
          nameWithOwner={nameWithOwner}
          disabled={disabled}
        />
      ) : (
        <div className="rounded-md border border-border overflow-hidden flex flex-col gap-2">
          <div className="flex flex-col gap-2 p-2">
            <div className="flex items-start gap-2 min-w-0">
              <GitPullRequest className="size-4 shrink-0 text-foreground-muted mt-0.5" />
              <div className="flex flex-col min-w-0 gap-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-mono text-xs text-foreground-muted shrink-0">
                    #{state.linkedPR.metadata.number}
                  </span>
                  {state.linkedPR.isDraft && (
                    <span className="text-xs text-foreground-muted border border-border rounded px-1 shrink-0">
                      Draft
                    </span>
                  )}
                  <span className="text-sm truncate font-medium">{state.linkedPR.title}</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-foreground-muted">
                  <code className="text-xs">{state.linkedPR.metadata.headRefName}</code>
                  {state.linkedPR.author && (
                    <>
                      <span>·</span>
                      <span>{state.linkedPR.author.userName}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between h-6 px-2 text-xs bg-background-1 border-t border-border">
            <div className="text-foreground-muted"></div>
            <div className="text-foreground-muted">
              <button className="flex items-center gap-2" onClick={handleDeselect}>
                Select another PR
              </button>
            </div>
          </div>
        </div>
      )}

      <ToggleGroup
        className="w-full"
        value={[state.checkoutMode]}
        onValueChange={([value]) => {
          if (value) state.setCheckoutMode(value as CheckoutMode);
        }}
      >
        <ToggleGroupItem className="flex-1 gap-1.5" value="checkout">
          <GitBranch className="size-3.5" />
          Checkout branch
        </ToggleGroupItem>
        <ToggleGroupItem className="flex-1 gap-1.5" value="new-branch">
          <GitBranch className="size-3.5" />
          Create task branch
        </ToggleGroupItem>
      </ToggleGroup>

      <TaskNameField state={state} />
    </div>
  );
}
