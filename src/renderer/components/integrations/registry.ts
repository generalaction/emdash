// Static metadata for all integrations rendered by IntegrationsCard.
//
// This is the source of truth for which integrations exist. Both the
// IntegrationsCard UI and the settings search index are validated against
// this list (see src/test/renderer/settingsSearchIndex.test.ts) so that
// adding a new integration here will fail tests until it is also added to
// SETTINGS_INDEX.

export interface IntegrationRegistryEntry {
  id: string;
  name: string;
  description: string;
}

export const INTEGRATION_REGISTRY: readonly IntegrationRegistryEntry[] = [
  { id: 'github', name: 'GitHub', description: 'Connect your repositories' },
  { id: 'linear', name: 'Linear', description: 'Work on Linear tickets' },
  { id: 'jira', name: 'Jira', description: 'Work on Jira tickets' },
  { id: 'gitlab', name: 'GitLab', description: 'Work on GitLab issues' },
  { id: 'plain', name: 'Plain', description: 'Work on support threads' },
  { id: 'forgejo', name: 'Forgejo', description: 'Work on Forgejo issues' },
  { id: 'sentry', name: 'Sentry', description: 'Fix errors from Sentry' },
] as const;

export type IntegrationId = (typeof INTEGRATION_REGISTRY)[number]['id'];
