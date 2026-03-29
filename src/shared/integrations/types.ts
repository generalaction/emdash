/**
 * Canonical integration identifiers — one per external service.
 * Used by AutomationsService and mapped from TriggerType.
 */
export type IntegrationId =
  | 'github'
  | 'linear'
  | 'jira'
  | 'gitlab'
  | 'plain'
  | 'forgejo'
  | 'sentry';

/** Status map returned to the renderer via IPC */
export type IntegrationStatusMap = Record<IntegrationId, boolean>;

/** Human-readable labels for each integration */
export const INTEGRATION_LABELS: Record<IntegrationId, string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
  gitlab: 'GitLab',
  plain: 'Plain',
  forgejo: 'Forgejo',
  sentry: 'Sentry',
};
