import type { HostRef } from '@emdash/core/primitives/host/api';
import { CheckCircle2, Clock3, ExternalLink, Info, Loader2 } from 'lucide-react';
import { useAgentHooksStatus } from '@core/features/agents/api/browser/use-agent-hooks-status';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import type { AgentPayload } from '@core/primitives/agents/api';
import { Button } from '@core/primitives/ui/browser/button';
import { Field } from '@core/primitives/ui/browser/field';
import { Label } from '@core/primitives/ui/browser/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@core/primitives/ui/browser/tooltip';

function InfoTooltip({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>
          <button
            type="button"
            className="text-foreground-muted hover:text-foreground"
            aria-label="More information"
          >
            <Info className="size-3.5" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function IntegrationRow({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <InfoTooltip>{tooltip}</InfoTooltip>
      </div>
      {children}
    </div>
  );
}

export function AgentIntegrationSection({
  agent,
  host,
  onManageSettings,
}: {
  agent: AgentPayload;
  host: HostRef;
  onManageSettings: () => void;
}) {
  const supportsHooks = agent.capabilities.hooks.kind !== 'none';
  const supportsTrust = agent.capabilities.trust.kind !== 'none';
  const { status, isLoading } = useAgentHooksStatus(agent.id, host, supportsHooks);
  const { value: taskSettings } = useAppSettingsKey('tasks');

  const showHooks =
    supportsHooks &&
    (host.type !== 'remote' || isLoading || (status !== null && status !== undefined));
  if (!showHooks && !supportsTrust) return null;

  return (
    <Field>
      <Label>Integrations</Label>
      <div className="space-y-2">
        {showHooks && (
          <IntegrationRow
            label="Hooks"
            tooltip="Hooks let Emdash track agent status, deliver notifications, and capture session IDs for reliable resume."
          >
            {isLoading ? (
              <Loader2 className="size-3.5 animate-spin text-foreground-muted" />
            ) : status?.state === 'installed' ? (
              <span
                className="flex min-w-0 items-center gap-1.5 text-xs text-foreground-muted"
                title={status.resolvedRoot}
              >
                <CheckCircle2 className="size-3.5 shrink-0 text-foreground-success" />
                <span className="truncate">Configured · {status.resolvedRoot}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
                <Clock3 className="size-3.5 shrink-0" />
                Will be configured when you start a session
              </span>
            )}
          </IntegrationRow>
        )}
        {supportsTrust && (
          <IntegrationRow
            label="Workspace trust"
            tooltip={
              agent.id === 'cursor'
                ? 'Cursor trust is applied through an internal marker format that may change in future Cursor releases.'
                : 'When enabled, Emdash marks newly created task worktrees as trusted before the agent starts.'
            }
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-foreground-muted">
                {taskSettings?.autoTrustWorktrees
                  ? 'Automatic trust enabled'
                  : 'Automatic trust disabled'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={onManageSettings}
              >
                <ExternalLink className="size-3" aria-hidden="true" />
                Manage in Settings
              </Button>
            </div>
          </IntegrationRow>
        )}
      </div>
    </Field>
  );
}
