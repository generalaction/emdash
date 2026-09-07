import type { PluginIconAsset } from '@emdash/shared/plugins';
import { PluginIcon } from '@core/features/agents/contributions/browser/plugin-icon';
import { useIntegrationsContext } from '@core/features/integrations/contributions/browser/integrations-provider';

type IntegrationIconProps = {
  provider: string;
  icon?: PluginIconAsset;
  size?: number;
  className?: string;
};

export function IntegrationIcon({ provider, icon, size = 16, className }: IntegrationIconProps) {
  const { integrationById } = useIntegrationsContext();
  const resolvedIcon = icon ?? integrationById[provider]?.icon;
  if (!resolvedIcon) return null;

  return <PluginIcon id={provider} icon={resolvedIcon} size={size} className={className} />;
}
