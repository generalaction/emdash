import type { McpProvidersResponse } from '@emdash/core/primitives/mcp/api';
import type { AgentProviderId } from '@emdash/plugins/agents';
import { Check, Plus, X } from 'lucide-react';
import React from 'react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@renderer/lib/ui/popover';
import { cn } from '@renderer/utils/utils';

interface SyncToAgentsSectionProps {
  providers: McpProvidersResponse[];
  selectedProviders: string[];
  transport: 'stdio' | 'http';
  onToggle: (id: string) => void;
  onSetAll: (ids: string[]) => void;
}

export const SyncToAgentsSection: React.FC<SyncToAgentsSectionProps> = ({
  providers,
  selectedProviders,
  transport,
  onToggle,
  onSetAll,
}) => {
  const selectedProviderIds = new Set(selectedProviders);
  const providersById = new Map(providers.map((provider) => [provider.id, provider]));
  const selected = selectedProviders
    .map((id) => providersById.get(id))
    .filter((provider): provider is McpProvidersResponse => Boolean(provider));
  const syncableInstalledProviders = providers.filter((provider) =>
    isProviderSyncable(provider, transport)
  );

  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>Sync to agents</FieldLabel>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          disabled={syncableInstalledProviders.length === 0}
          onClick={() => onSetAll(syncableInstalledProviders.map((provider) => provider.id))}
        >
          Sync to all installed agents
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {selected.map((provider) => (
          <div
            key={provider.id}
            className={cn(
              'group relative inline-flex h-8 items-center gap-1.5 rounded-full border border-primary bg-primary/10 pr-3 pl-2 text-xs text-foreground ring-1 ring-primary/30 transition-colors',
              'hover:border-destructive/60 hover:bg-background-destructive hover:text-foreground-destructive'
            )}
            title={`Synced to ${provider.name}`}
          >
            <AgentIcon
              id={provider.id as AgentProviderId}
              size={16}
              className="rounded-sm transition-opacity group-hover:opacity-35"
            />
            <span className="transition-opacity group-hover:opacity-35">{provider.name}</span>
            <button
              type="button"
              className="absolute right-2 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => onToggle(provider.id)}
              aria-label={`Remove ${provider.name} from synced agents`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full border-dashed px-3 text-xs"
              >
                <Plus className="h-3 w-3" />
                Add agent
              </Button>
            }
          />
          <PopoverContent align="start" className="w-72 gap-3 p-3">
            <PopoverHeader>
              <PopoverTitle>Add agent</PopoverTitle>
              <PopoverDescription>
                Select an installed agent to sync this MCP server.
              </PopoverDescription>
            </PopoverHeader>
            <div className="max-h-72 overflow-y-auto">
              {providers.length === 0 ? (
                <p className="text-muted-foreground px-2 py-3 text-xs">
                  No MCP-capable agents are available.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {providers.map((provider) => {
                    const selected = selectedProviderIds.has(provider.id);
                    const disabledReason = providerDisabledReason(provider, transport);
                    const disabled = Boolean(disabledReason);
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => !selected && onToggle(provider.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors',
                          'hover:bg-background-quaternary-1 focus:bg-background-quaternary-1',
                          disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent',
                          selected && 'bg-background-quaternary-2 text-foreground'
                        )}
                      >
                        <AgentIcon
                          id={provider.id as AgentProviderId}
                          size={16}
                          className="rounded-sm"
                          grayscale={disabled}
                        />
                        <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                        {disabledReason ? (
                          <span className="text-muted-foreground shrink-0 text-[10px]">
                            {disabledReason}
                          </span>
                        ) : selected ? (
                          <Check className="text-primary h-3.5 w-3.5 shrink-0" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {transport === 'http' &&
        providers.some(
          (provider) => provider.installed && provider.supportsMcp && !provider.supportsHttp
        ) && (
          <p className="text-muted-foreground mt-1.5 text-xs">
            Some agents don't support HTTP servers and are disabled.
          </p>
        )}
    </Field>
  );
};

function isProviderSyncable(provider: McpProvidersResponse, transport: 'stdio' | 'http'): boolean {
  return (
    provider.installed && provider.supportsMcp && (transport !== 'http' || provider.supportsHttp)
  );
}

function providerDisabledReason(
  provider: McpProvidersResponse,
  transport: 'stdio' | 'http'
): string | null {
  if (!provider.supportsMcp) return 'No MCP';
  if (!provider.installed) return 'Not installed';
  if (transport === 'http' && !provider.supportsHttp) return 'No HTTP';
  return null;
}
