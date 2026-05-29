import { AGENT_PROVIDER_IDS, type AgentProviderId } from '@shared/agent-provider-registry';
import { APP_NAME_LOWER } from '@shared/app-identity';
import type { AppDeepLinkEvent } from '@shared/events/appEvents';

const LINEAR_IDENTIFIER_RE = /[A-Z][A-Z0-9]+-\d+/i;
const AGENT_PROVIDER_ID_SET = new Set<string>(AGENT_PROVIDER_IDS);

function firstQueryValue(params: URLSearchParams, names: string[]): string | undefined {
  for (const name of names) {
    const value = params.get(name)?.trim();
    if (value) return value;
  }
  return undefined;
}

function parseLinearIssueIdentifier(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(LINEAR_IDENTIFIER_RE);
    if (match) return match[0].toUpperCase();
  } catch {}

  const match = value.match(LINEAR_IDENTIFIER_RE);
  return match?.[0].toUpperCase();
}

function parseAgentProvider(value: string | undefined): AgentProviderId | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  return AGENT_PROVIDER_ID_SET.has(normalized) ? (normalized as AgentProviderId) : undefined;
}

export function parseLinearAgentDeepLink(rawUrl: string): AppDeepLinkEvent | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${APP_NAME_LOWER}:`) return null;

  const pathParts = parsed.pathname.split('/').filter(Boolean);
  const host = parsed.hostname.toLowerCase();
  const action = [host, ...pathParts].join('/').toLowerCase();
  const isLinearAgentAction =
    action === 'linear-agent' ||
    action.startsWith('linear-agent/') ||
    action === 'linear/agent' ||
    action.startsWith('linear/agent/') ||
    action === 'linear/agents' ||
    action.startsWith('linear/agents/') ||
    action === 'agents/linear' ||
    action.startsWith('agents/linear/');

  if (!isLinearAgentAction) return null;

  const issueUrl = firstQueryValue(parsed.searchParams, ['issueUrl', 'issueURL', 'url']);
  const identifier = parseLinearIssueIdentifier(
    firstQueryValue(parsed.searchParams, [
      'identifier',
      'issueIdentifier',
      'issueKey',
      'issue',
      'key',
    ]) ??
      issueUrl ??
      pathParts.at(-1)
  );

  if (!identifier) return null;

  return {
    type: 'linear-agent',
    projectId: firstQueryValue(parsed.searchParams, ['projectId', 'project']),
    agentProvider: parseAgentProvider(
      firstQueryValue(parsed.searchParams, ['agentProvider', 'provider', 'agent'])
    ),
    prompt: firstQueryValue(parsed.searchParams, ['prompt', 'message', 'instructions']),
    issue: {
      identifier,
      url: issueUrl,
      title: firstQueryValue(parsed.searchParams, ['issueTitle', 'title']),
      description: firstQueryValue(parsed.searchParams, ['issueDescription', 'description']),
      branchName: firstQueryValue(parsed.searchParams, ['branchName', 'branch']),
    },
  };
}
