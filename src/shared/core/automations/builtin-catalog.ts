import type { BuiltinAutomationTemplate } from './automation';

const TEST_COVERAGE_PROMPT =
  'Inspect recent merged code for meaningful regression risk and add the smallest deterministic tests for weakly covered behavior. Prioritize new code paths, bug fixes without tests, edge-case parsing, concurrency, permissions, validation, shared utilities, and core flows. Avoid low-signal snapshots and cosmetic-only changes. Follow existing test conventions, run relevant validation, and summarize what risky behavior is now covered.';

export const builtinAutomationCatalog: BuiltinAutomationTemplate[] = [
  {
    id: 'critical-bug-finder',
    category: 'Code quality',
    name: 'Find critical bugs',
    description: 'Analyze recent commits for high-severity correctness bugs and submit safe fixes',
    icon: 'Bug',
    defaultTrigger: { expr: '0 10 * * MON-FRI', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Inspect recent code changes for high-severity correctness bugs, regressions, race conditions, data loss risks, and broken edge cases. If you find a real issue, implement the smallest safe fix and validate it with targeted tests.',
    },
  },
  {
    id: 'daily-change-summary',
    category: 'Status reports',
    name: 'Summarize changes daily',
    description:
      'Post a daily digest summarizing notable repository changes and risks from the previous day',
    icon: 'Mail',
    defaultTrigger: { expr: '0 9 * * MON-FRI', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Create a concise daily digest of notable repository changes from the previous day. Highlight shipped work, risky changes, migrations, open blockers, and recommended follow-ups.',
    },
  },
  {
    id: 'codebase-vulnerability-scan',
    category: 'Security',
    name: 'Scan for vulnerabilities',
    description:
      'Review the full repository on a schedule and alert on validated high-impact security issues',
    icon: 'Search',
    defaultTrigger: { expr: '0 11 * * MON', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Review the repository for validated high-impact security vulnerabilities. Focus on authentication, authorization, injection, secret handling, unsafe filesystem or shell usage, SSRF, deserialization, and privilege boundaries. Avoid noisy theoretical findings; only report or fix exploitable issues.',
    },
  },
  {
    id: 'datadog-error-investigation',
    category: 'Incidents & triage',
    name: 'Investigate production errors',
    description:
      'Use error details you provide in the prompt or project docs to identify root causes and propose fixes',
    icon: 'Search',
    defaultTrigger: { expr: '0 13 * * MON-FRI', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Investigate recurring production errors described in the project context, linked issues, logs, or prompt notes. Identify likely root causes in the codebase, determine user impact, propose the smallest safe fix, and call out any missing telemetry needed to confirm the diagnosis. If no error details are available, report what information is needed instead of guessing.',
    },
  },
  {
    id: 'test-coverage',
    category: 'Code quality',
    name: 'Add test coverage',
    description:
      'Review recent changes and add tests for high-risk logic that lacks adequate coverage',
    icon: 'FlaskConical',
    defaultTrigger: { expr: '0 10 * * TUE', tz: 'UTC' },
    defaultConversationConfig: { initialPrompt: TEST_COVERAGE_PROMPT },
  },
  {
    id: 'feature-flag-cleanup',
    category: 'Code quality',
    name: 'Clean up feature flags',
    description: 'Find stale feature flags that are fully rolled out and remove dead code paths',
    icon: 'Flag',
    defaultTrigger: { expr: '0 12 * * WED', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Find stale feature flags that appear fully rolled out or permanently disabled. For safe cases, remove dead branches and simplify affected code. Preserve behavior, update tests, and call out flags that need product confirmation instead of changing them.',
    },
  },
  {
    id: 'reported-bugs',
    category: 'Incidents & triage',
    name: 'Fix reported bugs',
    description:
      'Investigate bug reports you provide in issues, docs, or prompt notes and fix with a PR',
    icon: 'Wrench',
    defaultTrigger: { expr: '0 10 * * MON-FRI', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Review recent bug reports described in linked issues, project docs, or prompt notes. For actionable issues, reproduce or reason through the failure, identify the responsible code path, implement the smallest safe fix, add regression coverage, and prepare a PR summary. If no bug-report details are available, report what information is needed instead of guessing.',
    },
  },
  {
    id: 'docs-generator',
    category: 'Documentation',
    name: 'Generate docs',
    description:
      'Create and update developer documentation for recently changed or under-documented code',
    icon: 'BookOpen',
    defaultTrigger: { expr: '0 14 * * FRI', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Find recently changed or under-documented developer-facing code. Add concise documentation that explains behavior, setup, examples, sharp edges, and validation steps. Prefer updating existing docs over creating duplicate pages.',
    },
  },
  {
    id: 'pagerduty-incident-investigation',
    category: 'Incidents & triage',
    name: 'Investigate incidents',
    description: 'Investigate incidents using provided incident details and code context',
    icon: 'Search',
    defaultTrigger: { expr: '0 15 * * MON-FRI', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Investigate recent incidents described in linked issues, project docs, logs, or prompt notes using the codebase as context. Summarize likely causes, affected systems, contributing code paths, missing safeguards, and concrete follow-up fixes. If no incident details are available, report what information is needed instead of guessing.',
    },
  },
];

export const pinnedAutomationTemplates = builtinAutomationCatalog.slice(0, 5);

export const emptyStateAutomationTemplates = builtinAutomationCatalog.slice(0, 3);

export const automationCatalogCategories = [
  'Status reports',
  'Incidents & triage',
  'Code quality',
  'Security',
  'Documentation',
] as const;
