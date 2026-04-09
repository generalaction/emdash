import React from 'react';
import { AgentProviderId } from '@shared/agent-provider-registry';
import type { McpProvidersResponse } from '@shared/mcp/types';
import { agentConfig } from '../../lib/agentConfig';
import AgentLogo from '../agent-logo';
import { Button } from '../ui/button';
import { Field, FieldLabel } from '../ui/field';

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
            const logo = agentConfig[p.id as AgentProviderId];
            return (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={unsupported}
                onClick={() => onToggle(p.id)}
                title={unsupported ? `${p.name} does not support HTTP servers` : undefined}
                className={
                  'gap-1.5 ' +
                  (unsupported
                    ? 'cursor-not-allowed border-border text-muted-foreground/40'
                    : selectedProviders.has(p.id)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50')
                }
              >
                {logo && (
                  <AgentLogo
                    logo={logo.logo}
                    alt={logo.alt}
                    isSvg={logo.isSvg}
                    invertInDark={logo.invertInDark}
                    className="h-4 w-4 rounded-sm"
                    grayscale={unsupported}
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
