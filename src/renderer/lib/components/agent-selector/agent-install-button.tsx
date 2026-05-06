import { Download, Loader2 } from 'lucide-react';
import type React from 'react';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { getAgentInstallActionState } from './agent-install';

type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

type AgentInstallButtonProps = {
  agentId: AgentProviderId;
  canInstall: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  className?: string;
  tooltipSide?: TooltipSide;
};

export function AgentInstallButton({
  agentId,
  canInstall,
  isInstalled,
  isInstalling,
  onInstall,
  disabled = false,
  className,
  tooltipSide = 'right',
}: AgentInstallButtonProps) {
  const state = getAgentInstallActionState({
    agentId,
    canInstall,
    isInstalled,
    isInstalling,
  });

  if (!state.render) {
    return null;
  }

  const InstallIcon = state.installing ? Loader2 : Download;

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
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
        </TooltipTrigger>
        <TooltipContent side={tooltipSide} className="text-xs">
          {state.label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
