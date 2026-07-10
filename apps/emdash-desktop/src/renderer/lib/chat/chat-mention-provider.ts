import type { ChatMentionMeta, MentionProvider } from '@emdash/chat-ui';
import type { AgentIconAsset } from '@shared/core/agents/agent-payload';
import type { IssueProviderType } from '@shared/issue-providers';
import { pickIconVariant } from '../components/agent-icon-variant';
import { workspaceFileMentionProvider } from './workspace-file-mention-provider';

type IntegrationIconInput = {
  id: string;
  icon?: AgentIconAsset;
  features?: string[];
};

export type IssueMentionTarget = {
  token: string;
  provider: IssueProviderType;
  identifier: string;
};

const issueProviderIconUrls = new Map<string, string>();

export function issueMentionToken(provider: IssueProviderType, identifier: string): string {
  return `issue:${provider}:${identifier}`;
}

export function parseIssueMentionToken(token: string): IssueMentionTarget | null {
  if (!token.startsWith('issue:')) return null;
  const rest = token.slice('issue:'.length);
  const providerEnd = rest.indexOf(':');
  if (providerEnd <= 0) return null;
  const provider = rest.slice(0, providerEnd) as IssueProviderType;
  const identifier = rest.slice(providerEnd + 1);
  if (!identifier) return null;
  return { token, provider, identifier };
}

export function registerIssueMentionIcons(integrations: IntegrationIconInput[]): void {
  issueProviderIconUrls.clear();
  for (const integration of integrations) {
    if (!integration.features?.includes('issues') || !integration.icon) continue;
    const url = iconAssetToUrl(integration.id, integration.icon);
    if (url) issueProviderIconUrls.set(integration.id, url);
  }
}

function iconAssetToUrl(id: string, icon: AgentIconAsset): string | null {
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

class ChatMentionProvider implements MentionProvider {
  resolve(token: string, _uri?: string): ChatMentionMeta | null {
    const issue = parseIssueMentionToken(token);
    if (issue) {
      return {
        id: issue.token,
        label: issue.token,
        name: issue.identifier,
        kind: 'issue',
        iconUrl: issueProviderIconUrls.get(issue.provider),
      };
    }

    return workspaceFileMentionProvider.resolve(token);
  }
}

export const chatMentionProvider = new ChatMentionProvider();
