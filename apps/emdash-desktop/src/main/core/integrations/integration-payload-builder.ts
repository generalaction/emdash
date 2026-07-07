import {
  integrationPluginRegistry,
  type IntegrationAuthDescriptor,
} from '@emdash/plugins/integrations';
import { issuesPluginRegistry } from '@emdash/plugins/issues';
import type { IssueProviderCapabilities } from '@shared/issue-providers';

function issueCapabilities(integrationId: string): IssueProviderCapabilities {
  const plugin = issuesPluginRegistry.get(integrationId);
  const requiredInputs = plugin?.capabilities.issues.requiredInputs ?? [];
  return {
    requiresRepositoryUrl: requiredInputs.includes('repositoryUrl'),
    supportsIssueContext: !!plugin?.behavior.issues?.getIssue,
  };
}

function features(integrationId: string): string[] {
  const tags = issuesPluginRegistry.get(integrationId) ? ['issues'] : [];
  // GitHub's PR/repository support has no plugin type yet; keep the tags as a
  // documented exception until those capabilities exist.
  if (integrationId === 'github') tags.push('pullRequests', 'repositories');
  return tags;
}

/** Lowercase the leading letter unless the label starts with an acronym. */
function sentenceCase(label: string): string {
  if (label.length >= 2 && label[1] === label[1]?.toUpperCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * Label for the disconnect confirmation ("This will delete the saved
 * <name> <label>..."). A single required form field names exactly what gets
 * deleted; multi-field forms fall back to "credentials".
 */
function disconnectCredentialLabel(auth: IntegrationAuthDescriptor): string | undefined {
  const form = auth.methods.find((method) => method.kind === 'form');
  if (!form || form.kind !== 'form') return undefined;
  const requiredFields = form.fields.filter((field) => field.required);
  if (requiredFields.length === 1 && requiredFields[0]) {
    return sentenceCase(requiredFields[0].label);
  }
  return 'credentials';
}

export function buildIntegrationListPayload() {
  return integrationPluginRegistry.getAll().map((plugin) => ({
    id: plugin.metadata.id,
    name: plugin.metadata.name,
    description: plugin.metadata.description,
    websiteUrl: plugin.metadata.websiteUrl,
    features: features(plugin.metadata.id),
    disconnectCredentialLabel: disconnectCredentialLabel(plugin.capabilities.auth),
    capabilities: issueCapabilities(plugin.metadata.id),
    auth: plugin.capabilities.auth,
    icon: plugin.assets.icon,
  }));
}
