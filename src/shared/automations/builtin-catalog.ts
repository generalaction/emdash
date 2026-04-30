import type { BuiltinAutomationTemplate } from '@shared/automations/types';

const TEST_COVERAGE_PROMPT = `You are a test coverage automation focused on preventing regressions.

## Goal

Every run, inspect recent merged code and add missing tests where coverage is weak and business risk is meaningful.

## Prioritization

Prioritize:
- New code paths without tests.
- Bug fixes that only changed production code.
- Edge-case logic, parsing, concurrency, permissions, and data validation.
- Shared utilities and core flows with large blast radius.

Avoid:
- Trivial snapshots with little signal.
- Tests for cosmetic-only changes.
- Refactors that do not change behavior unless critical behavior is now untested.

## Implementation rules

- Follow existing test conventions and fixture patterns.
- Keep tests deterministic and independent.
- Add the minimum set of tests that clearly prove correctness.
- Do not change production behavior unless a tiny testability refactor is required.

## Validation

- Run the relevant test targets for touched areas.
- If tests are flaky or environment-dependent, note it explicitly and avoid merging fragile tests.

## Output

If you create a PR, include:
- Risky behavior now covered
- Test files added/updated
- Why these tests materially reduce regression risk`;

export const builtinAutomationCatalog: BuiltinAutomationTemplate[] = [
  {
    id: 'critical-bug-finder',
    category: 'Code quality',
    name: 'Find critical bugs',
    description: 'Analyze recent commits for high-severity correctness bugs and submit safe fixes',
    icon: 'Bug',
    defaultTrigger: { kind: 'cron', expr: '0 10 * * MON-FRI', tz: 'UTC' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Inspect recent code changes for high-severity correctness bugs, regressions, race conditions, data loss risks, and broken edge cases. If you find a real issue, implement the smallest safe fix and validate it with targeted tests.',
      },
    ],
  },
  {
    id: 'daily-change-summary',
    category: 'Status reports',
    name: 'Summarize changes daily',
    description:
      'Post a daily digest summarizing notable repository changes and risks from the previous day',
    icon: 'Mail',
    defaultTrigger: { kind: 'cron', expr: '0 9 * * MON-FRI', tz: 'UTC' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Create a concise daily digest of notable repository changes from the previous day. Highlight shipped work, risky changes, migrations, open blockers, and recommended follow-ups.',
      },
    ],
  },
  {
    id: 'codebase-vulnerability-scan',
    category: 'Security',
    name: 'Scan codebase for vulnerabilities',
    description:
      'Review the full repository on a schedule and alert on validated high-impact security issues',
    icon: 'Search',
    defaultTrigger: { kind: 'cron', expr: '0 11 * * MON', tz: 'UTC' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Review the repository for validated high-impact security vulnerabilities. Focus on authentication, authorization, injection, secret handling, unsafe filesystem or shell usage, SSRF, deserialization, and privilege boundaries. Avoid noisy theoretical findings; only report or fix exploitable issues.',
      },
    ],
  },
  {
    id: 'datadog-error-investigation',
    category: 'Incidents & triage',
    name: 'Investigate production errors',
    description:
      'Use error details you provide in the prompt or project docs to identify root causes and propose fixes',
    icon: 'Search',
    defaultTrigger: { kind: 'cron', expr: '0 13 * * MON-FRI', tz: 'UTC' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Investigate recurring production errors described in the project context, linked issues, logs, or prompt notes. Identify likely root causes in the codebase, determine user impact, propose the smallest safe fix, and call out any missing telemetry needed to confirm the diagnosis. If no error details are available, report what information is needed instead of guessing.',
      },
    ],
  },
  {
    id: 'test-coverage',
    category: 'Code quality',
    name: 'Add test coverage',
    description:
      'Review recent changes and add tests for high-risk logic that lacks adequate coverage',
    icon: 'FlaskConical',
    defaultTrigger: { kind: 'cron', expr: '0 10 * * TUE,THU', tz: 'UTC' },
    defaultActions: [{ kind: 'task.create', prompt: TEST_COVERAGE_PROMPT }],
  },
  {
    id: 'assign-pr-reviewers',
    category: 'Code review',
    name: 'Assign PR reviewers',
    description: 'Assign reviewers based on code changes and auto-approve low-risk PRs',
    icon: 'GitPullRequest',
    defaultTrigger: { kind: 'event', event: 'pr.opened' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Review the newly opened pull request, identify the best reviewers based on ownership and touched areas, and determine whether the PR is low-risk enough to approve. Explain the reviewer rationale and any risks that need human attention.',
      },
    ],
  },
  {
    id: 'feature-flag-cleanup',
    category: 'Code quality',
    name: 'Clean up feature flags',
    description: 'Find stale feature flags that are fully rolled out and remove dead code paths',
    icon: 'Flag',
    defaultTrigger: { kind: 'cron', expr: '0 12 * * WED', tz: 'UTC' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Find stale feature flags that appear fully rolled out or permanently disabled. For safe cases, remove dead branches and simplify affected code. Preserve behavior, update tests, and call out flags that need product confirmation instead of changing them.',
      },
    ],
  },
  {
    id: 'pr-security-review',
    category: 'Security',
    name: 'Find vulnerabilities',
    description:
      'Review pull requests for exploitable security issues and flag only validated findings before merge',
    icon: 'ShieldCheck',
    defaultTrigger: { kind: 'event', event: 'pr.opened' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Review the pull request for exploitable security issues. Focus on concrete attack paths introduced by the change. Flag only validated findings, include severity and reproduction reasoning, and avoid theoretical noise.',
      },
    ],
  },
  {
    id: 'slack-bug-reports',
    category: 'Incidents & triage',
    name: 'Fix reported bugs',
    description:
      'Investigate bug reports you provide in issues, docs, or prompt notes and fix with a PR',
    icon: 'Wrench',
    defaultTrigger: { kind: 'cron', expr: '*/30 * * * MON-FRI', tz: 'UTC' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Review recent bug reports described in linked issues, project docs, or prompt notes. For actionable issues, reproduce or reason through the failure, identify the responsible code path, implement the smallest safe fix, add regression coverage, and prepare a PR summary. If no bug-report details are available, report what information is needed instead of guessing.',
      },
    ],
  },
  {
    id: 'ci-failure-fixer',
    category: 'Incidents & triage',
    name: 'Fix CI failures',
    description: 'Detect CI failures on main and automatically open PRs',
    icon: 'KeyRound',
    defaultTrigger: { kind: 'event', event: 'ci.failed' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Triage the failed CI run. Identify the failing job, root cause, and whether the failure is flaky. If there is a safe code or test fix, implement it, run the relevant validation, and prepare a PR-ready summary.',
      },
    ],
  },
  {
    id: 'docs-generator',
    category: 'Documentation',
    name: 'Generate docs',
    description:
      'Create and update developer documentation for recently changed or under-documented code',
    icon: 'BookOpen',
    defaultTrigger: { kind: 'cron', expr: '0 14 * * FRI', tz: 'UTC' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Find recently changed or under-documented developer-facing code. Add concise documentation that explains behavior, setup, examples, sharp edges, and validation steps. Prefer updating existing docs over creating duplicate pages.',
      },
    ],
  },
  {
    id: 'pagerduty-incident-investigation',
    category: 'Incidents & triage',
    name: 'Investigate incidents',
    description: 'Investigate incidents using provided incident details and code context',
    icon: 'Search',
    defaultTrigger: { kind: 'cron', expr: '0 15 * * MON-FRI', tz: 'UTC' },
    defaultActions: [
      {
        kind: 'task.create',
        prompt:
          'Investigate recent incidents described in linked issues, project docs, logs, or prompt notes using the codebase as context. Summarize likely causes, affected systems, contributing code paths, missing safeguards, and concrete follow-up fixes. If no incident details are available, report what information is needed instead of guessing.',
      },
    ],
  },
];

export const automationCatalogCategories = [
  'Status reports',
  'Incidents & triage',
  'Code quality',
  'Code review',
  'Security',
  'Documentation',
] as const;

export type AutomationCategory = (typeof automationCatalogCategories)[number];
