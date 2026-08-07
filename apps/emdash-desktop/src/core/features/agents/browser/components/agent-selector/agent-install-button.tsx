import type { AgentProviderId } from '@emdash/plugins/agents';
import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { Download, Loader2 } from 'lucide-react';
import type React from 'react';
import { getAgentInstallActionState } from '@core/features/agents/api/browser/components/agent-selector/agent-install';
import { cn } from '@core/primitives/styling/browser/cn';

type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

type AgentInstallButtonProps = {
  agentId: AgentProviderId;
  agentName: string;
  canInstall: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
  tooltipSide?: TooltipSide;
};

export function AgentInstallButton({
  agentName,
  canInstall,
  isInstalled,
  isInstalling,
  onInstall,
  disabled = false,
  className,
  tooltipSide = 'right',
}: AgentInstallButtonProps) {
  const state = getAgentInstallActionState({
    agentName,
    canInstall,
    isInstalled,
    isInstalling,
  });

  if (!state.render) {
    return null;
  }

  const InstallIcon = state.installing ? Loader2 : Download;

  return (
    <Tooltip.Provider delay={150}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            icon
            disabled={disabled || state.disabled}
            aria-label={state.label}
            onClick={onInstall}
            className={cn('ml-auto cursor-pointer', className)}
          >
            <InstallIcon
              className={cn('h-3 w-3', state.installing && 'animate-spin')}
              aria-hidden="true"
            />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side={tooltipSide} className="text-xs">
          {state.label}
        </Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
