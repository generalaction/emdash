import React from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import type { McpProvidersResponse } from '@shared/mcp/types';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { agentConfig } from '@renderer/utils/agentConfig';

interface ProviderSelectProps {
  providers: McpProvidersResponse[];
  selectedProviders: Set<string>;
  transport: 'stdio' | 'http';
  onToggle: (id: string) => void;
}

export const ProviderSelect: React.FC<ProviderSelectProps> = ({
  providers,
  selectedProviders,
  transport,
  onToggle,
}) => {
  return (
    <Field>
      <FieldLabel>Sync to agents</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {providers
          .filter((p) => p.installed)
          .map((p) => {
            const unsupported = transport === 'http' && !p.supportsHttp;
            const selected = selectedProviders.has(p.id);
            const logo = agentConfig[p.id as AgentProviderId];
            return (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                size="xs"
                disabled={unsupported}
                onClick={() => onToggle(p.id)}
                aria-pressed={selected}
                title={unsupported ? `${p.name} does not support HTTP servers` : undefined}
                className={
                  'gap-1.5 transition-colors ' +
                  (unsupported
                    ? 'cursor-not-allowed border-border/40 bg-transparent text-muted-foreground/40'
                    : selected
                      ? 'border-primary bg-primary/20 text-foreground ring-1 ring-primary/40 hover:bg-primary/25'
                      : 'border-border/40 bg-transparent text-muted-foreground/70 hover:border-border hover:bg-muted/40 hover:text-foreground')
                }
              >
                {logo && (
                  <AgentLogo
                    logo={logo.logo}
                    alt={logo.alt}
                    isSvg={logo.isSvg}
                    invertInDark={logo.invertInDark}
                    className="h-3.5 w-3.5 rounded-sm"
                    grayscale={unsupported || !selected}
                  />
                )}
                {p.name}
              </Button>
            );
          })}
      </div>
      {transport === 'http' && providers.some((p) => p.installed && !p.supportsHttp) && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Some agents don't support HTTP servers and are disabled.
        </p>
      )}
    </Field>
  );
};
