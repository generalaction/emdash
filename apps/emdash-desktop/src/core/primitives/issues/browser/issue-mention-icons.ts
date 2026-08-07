import type { PluginIconAsset } from '@emdash/shared/plugins';
import { pickIconVariant } from '@core/primitives/agents/browser/agent-icon-variant';

type IntegrationIconInput = {
  id: string;
  icon?: PluginIconAsset;
  features?: string[];
};

const issueProviderIconUrls = new Map<string, string>();

export function registerIssueMentionIcons(integrations: IntegrationIconInput[]): void {
  issueProviderIconUrls.clear();
  for (const integration of integrations) {
    if (!integration.features?.includes('issues') || !integration.icon) continue;
    const url = iconAssetToUrl(integration.id, integration.icon);
    if (url) issueProviderIconUrls.set(integration.id, url);
  }
}

export function issueMentionIconUrl(provider: string): string | undefined {
  return issueProviderIconUrls.get(provider);
}

function iconAssetToUrl(id: string, icon: PluginIconAsset): string | null {
  const variant = pickIconVariant(icon.variants, 16);
  const content = variant.light;
  if (!content) return null;
  if (icon.kind === 'image') return content;

  return `data:image/svg+xml;charset=utf-8,${encodeSvgDataUrl(content, id)}`;
}

function encodeSvgDataUrl(svg: string, id: string): string {
  return encodeURIComponent(
    svg.replace(/<svg\b(?![^>]*\brole=)/, `<svg role="img" aria-label="${id}"`)
  );
}
