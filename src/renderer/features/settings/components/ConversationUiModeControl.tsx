import { MessageSquare, SquareTerminal } from 'lucide-react';
import React from 'react';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { InterfaceSettings } from '@shared/app-settings';
import { resolveConversationUiModeSelection } from './conversation-ui-mode-selection';
import { ResetToDefaultButton } from './ResetToDefaultButton';

type ConversationUiMode = InterfaceSettings['conversationUiMode'];

interface ConversationUiModeControlProps {
  conversationUiMode: ConversationUiMode;
  isOverridden: boolean;
  disabled: boolean;
  onUpdate: (mode: ConversationUiMode) => void;
  onReset: () => void;
}

export function ConversationUiModeControl({
  conversationUiMode,
  isOverridden,
  disabled,
  onUpdate,
  onReset,
}: ConversationUiModeControlProps): React.JSX.Element {
  return (
    <>
      <ResetToDefaultButton
        visible={isOverridden}
        defaultLabel="terminal"
        onReset={onReset}
        disabled={disabled}
      />
      <TooltipProvider delay={150}>
        <ToggleGroup
          value={[conversationUiMode]}
          onValueChange={(value) => {
            const next = resolveConversationUiModeSelection(conversationUiMode, value);
            if (next) onUpdate(next);
          }}
          size="sm"
          className="h-9"
          aria-label="Default conversation UI"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <ToggleGroupItem
                  value="terminal"
                  aria-label="Terminal conversation UI"
                  disabled={disabled}
                >
                  <SquareTerminal className="size-4" />
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="top">Terminal</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <ToggleGroupItem value="chat" aria-label="Chat conversation UI" disabled={disabled}>
                  <MessageSquare className="size-4" />
                </ToggleGroupItem>
              }
            />
            <TooltipContent side="top">Chat</TooltipContent>
          </Tooltip>
        </ToggleGroup>
      </TooltipProvider>
    </>
  );
}
