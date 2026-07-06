import { PluginIcon } from '@renderer/lib/components/plugin-icon';
import type { AgentIconAsset } from '@shared/core/agents/agent-payload';
import { useIntegrationsContext } from './integrations-provider';

type IntegrationIconProps = {
  provider: string;
  icon?: AgentIconAsset;
  size?: number;
  className?: string;
};

export function IntegrationIcon({ provider, icon, size = 16, className }: IntegrationIconProps) {
  const { integrationById } = useIntegrationsContext();
  const resolvedIcon = icon ?? integrationById[provider]?.icon;
  if (!resolvedIcon) return null;

  return <PluginIcon id={provider} icon={resolvedIcon} size={size} className={className} />;
}
