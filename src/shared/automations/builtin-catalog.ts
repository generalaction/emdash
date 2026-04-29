import type { BuiltinAutomationTemplate } from '@shared/automations/types';

export const builtinAutomationCatalog: BuiltinAutomationTemplate[] = [
  {
    id: 'daily-status-report',
    category: 'Status reports',
    name: 'Daily status report',
    description: 'Summarize progress, blockers, and next steps for the project.',
    icon: 'ClipboardList',
    defaultTrigger: { kind: 'cron', expr: '0 9 * * MON-FRI', tz: 'UTC' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Create a concise daily status report for this project. Include shipped work, open blockers, risky areas, and the next concrete actions.',
      },
    ],
  },
  {
    id: 'weekly-release-prep',
    category: 'Release prep',
    name: 'Weekly release prep',
    description: 'Prepare a release checklist and call out unresolved risks.',
    icon: 'Rocket',
    defaultTrigger: { kind: 'cron', expr: '0 10 * * FRI', tz: 'UTC' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Prepare release notes and a release-readiness checklist for this repository. Highlight breaking changes, migrations, test gaps, and follow-up tasks.',
      },
    ],
  },
  {
    id: 'failed-ci-triage',
    category: 'Incidents & triage',
    name: 'Failed CI triage',
    description: 'Triage failing CI runs as soon as they happen.',
    icon: 'Siren',
    defaultTrigger: { kind: 'event', event: 'ci.failed', provider: 'github' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Triage the failed CI run on {{event.payload.workflow}} for branch {{event.payload.branch}}. Identify the failing job, likely root cause, whether it is flaky, and propose the smallest safe fix.',
      },
    ],
  },
  {
    id: 'pr-quality-review',
    category: 'Code quality',
    name: 'PR quality review',
    description: 'Review newly opened PRs for correctness and post a review comment.',
    icon: 'GitPullRequest',
    defaultTrigger: { kind: 'event', event: 'pr.opened', provider: 'github' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Review pull request "{{event.payload.title}}" ({{event.payload.url}}) for correctness, regressions, missing tests, and maintainability risks. Be specific and actionable.',
      },
    ],
  },
  {
    id: 'issue-intake',
    category: 'Incidents & triage',
    name: 'Issue intake',
    description: 'Triage newly opened issues from any configured provider.',
    icon: 'CircleDot',
    defaultTrigger: { kind: 'event', event: 'issue.opened', provider: null },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Triage the newly opened issue "{{event.payload.title}}" ({{event.payload.url}}). Reproduce the claim if possible, classify severity, ask clarifying questions, and propose next steps.',
      },
    ],
  },
];

export const automationCatalogCategories = [
  'Status reports',
  'Release prep',
  'Incidents & triage',
  'Code quality',
] as const;

export type AutomationCategory = (typeof automationCatalogCategories)[number];
