import { MessageSquare, SquareTerminal } from 'lucide-react';
import React from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Switch } from '@renderer/lib/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { resolveConversationUiModeSelection } from './conversation-ui-mode-selection';
import { ResetToDefaultButton } from './ResetToDefaultButton';
import { SettingRow } from './SettingRow';

const InterfaceSettingsCard: React.FC = () => {
  const {
    value: interfaceSettings,
    update,
    isLoading: loading,
    isSaving: saving,
    isFieldOverridden,
    resetField,
  } = useAppSettingsKey('interface');

  const confirmTabClose = interfaceSettings?.confirmTabClose ?? false;
  const conversationUiMode = interfaceSettings?.conversationUiMode ?? 'terminal';

  return (
    <div className="flex flex-col gap-4">
      <SettingRow
        title="Default conversation UI"
        description="Choose how new agent conversations open."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('conversationUiMode')}
              defaultLabel="terminal"
              onReset={() => resetField('conversationUiMode')}
              disabled={loading || saving}
            />
            <TooltipProvider delay={150}>
              <ToggleGroup
                value={[conversationUiMode]}
                onValueChange={(value) => {
                  const next = resolveConversationUiModeSelection(conversationUiMode, value);
                  if (next) update({ conversationUiMode: next });
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
                        disabled={loading || saving}
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
                      <ToggleGroupItem
                        value="chat"
                        aria-label="Chat conversation UI"
                        disabled={loading || saving}
                      >
                        <MessageSquare className="size-4" />
                      </ToggleGroupItem>
                    }
                  />
                  <TooltipContent side="top">Chat</TooltipContent>
                </Tooltip>
              </ToggleGroup>
            </TooltipProvider>
          </>
        }
      />
      <SettingRow
        title="Confirm tab close"
        description="Ask for confirmation before closing a tab."
        control={
          <>
            <ResetToDefaultButton
              visible={isFieldOverridden('confirmTabClose')}
              defaultLabel="off"
              onReset={() => resetField('confirmTabClose')}
              disabled={loading || saving}
            />
            <Switch
              checked={confirmTabClose}
              disabled={loading || saving}
              onCheckedChange={(checked) => update({ confirmTabClose: checked })}
            />
          </>
        }
      />
    </div>
  );
};

export default InterfaceSettingsCard;
