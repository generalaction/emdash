import { useIntegrationsContext } from '@core/features/integrations/api/browser/integrations-provider';
import type { AgentIconAsset } from '@core/primitives/agents/api';
import { PluginIcon } from '@core/primitives/ui/browser/components/plugin-icon';

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
