import type { BuiltinAutomationTemplate } from '@shared/automations/automation';

export const automationCatalogCategories = [
  'Code quality',
  'Security',
  'Incidents & triage',
  'Status reports',
  'Documentation',
  'Maintenance',
] as const;

export const automationTemplateIcons = [
  'Accessibility',
  'BookOpen',
  'Bug',
  'CalendarDays',
  'Eraser',
  'FileText',
  'Flag',
  'FlaskConical',
  'Gauge',
  'KeyRound',
  'ListTodo',
  'Mail',
  'PackageOpen',
  'Repeat',
  'Rocket',
  'ScrollText',
  'Search',
  'ShieldCheck',
  'Wrench',
] as const;

export type AutomationCatalogCategory = (typeof automationCatalogCategories)[number];
export type AutomationTemplateIcon = (typeof automationTemplateIcons)[number];

export type CatalogTemplate = Omit<BuiltinAutomationTemplate, 'category' | 'icon'> & {
  category: AutomationCatalogCategory;
  icon: AutomationTemplateIcon;
};

type CatalogTemplateInput = Omit<CatalogTemplate, 'category'>;

const TEST_COVERAGE_PROMPT =
  'Inspect recent merged code for meaningful regression risk and add the smallest deterministic tests for weakly covered behavior. Prioritize new code paths, bug fixes without tests, edge-case parsing, concurrency, permissions, validation, shared utilities, and core flows. Avoid low-signal snapshots and cosmetic-only changes. Follow existing test conventions, run relevant validation, and summarize what risky behavior is now covered.';

const builtinAutomationTemplateInputsByCategory = {
  'Code quality': [
    {
      id: 'critical-bug-finder',
      name: 'Find critical bugs',
      description:
        'Analyze recent commits for high-severity correctness bugs and submit safe fixes',
      icon: 'Bug',
      defaultTrigger: { expr: '0 10 * * MON-FRI', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Inspect recent code changes for high-severity correctness bugs, regressions, race conditions, data loss risks, and broken edge cases. If you find a real issue, implement the smallest safe fix and validate it with targeted tests.',
      },
    },
    {
      id: 'test-coverage',
      name: 'Add test coverage',
      description:
        'Review recent changes and add tests for high-risk logic that lacks adequate coverage',
      icon: 'FlaskConical',
      defaultTrigger: { expr: '0 10 * * 2', tz: 'UTC' },
      defaultConversationConfig: { initialPrompt: TEST_COVERAGE_PROMPT },
    },
    {
      id: 'flaky-test-hunter',
      name: 'Stabilize flaky tests',
      description:
        'Find tests that fail intermittently, diagnose the root cause, and make them deterministic',
      icon: 'Repeat',
      defaultTrigger: { expr: '0 8 * * 3', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Hunt for flaky tests: look for timing assumptions, shared state, order dependence, unawaited async work, and real-network or real-clock usage. Re-run suspicious tests repeatedly to confirm instability, fix the root cause where it is safe, and report tests that need a deeper rework instead of papering over failures with retries.',
      },
    },
    {
      id: 'performance-regression-review',
      name: 'Find performance regressions',
      description:
        'Review recent changes for slow paths, N+1 queries, and wasted renders, then fix the clear wins',
      icon: 'Gauge',
      defaultTrigger: { expr: '0 13 * * 4', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Review recent changes for performance problems: N+1 queries, blocking work on hot paths, accidental re-renders, unbounded growth in caches or lists, and oversized payloads. For confirmed issues, implement the smallest safe fix and explain the expected impact. Skip speculative micro-optimizations.',
      },
    },
    {
      id: 'accessibility-audit',
      name: 'Audit accessibility',
      description: 'Review changed UI code for accessibility issues and fix clear violations',
      icon: 'Accessibility',
      defaultTrigger: { expr: '0 10 * * 4', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Review recently changed UI code for accessibility problems: missing labels and roles, broken keyboard navigation and focus management, missing alt text, and dialogs or async updates that are invisible to assistive technology. Fix clear violations directly and report issues that need design decisions.',
      },
    },
  ],
  Security: [
    {
      id: 'codebase-vulnerability-scan',
      name: 'Scan for vulnerabilities',
      description:
        'Review the full repository on a schedule and alert on validated high-impact security issues',
      icon: 'Search',
      defaultTrigger: { expr: '0 11 * * 1', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Review the repository for validated high-impact security vulnerabilities. Focus on authentication, authorization, injection, secret handling, unsafe filesystem or shell usage, SSRF, deserialization, and privilege boundaries. Avoid noisy theoretical findings; only report or fix exploitable issues.',
      },
    },
    {
      id: 'dependency-audit',
      name: 'Audit dependency risk',
      description:
        'Check dependencies for known vulnerabilities and confirm which ones are actually exploitable',
      icon: 'ShieldCheck',
      defaultTrigger: { expr: '0 9 * * 2', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          "Audit dependencies for known vulnerabilities with the package manager's audit tooling. Check whether each finding is reachable from this codebase before acting on it, apply safe upgrades or mitigations for confirmed risks, and summarize anything that requires a coordinated major upgrade.",
      },
    },
    {
      id: 'secrets-hygiene',
      name: 'Check secret hygiene',
      description: 'Scan for hardcoded credentials and secrets leaking into logs or client code',
      icon: 'KeyRound',
      defaultTrigger: { expr: '0 12 * * 4', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          "Scan the repository for hardcoded credentials, tokens, and private keys, plus secrets leaking into logs, error messages, or client-side bundles. Distinguish real exposures from placeholders and test fixtures. Move genuine secrets into the project's configured secret handling and flag anything that needs rotation.",
      },
    },
  ],
  'Incidents & triage': [
    {
      id: 'datadog-error-investigation',
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
      id: 'reported-bugs',
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
      id: 'pagerduty-incident-investigation',
      name: 'Investigate incidents',
      description: 'Investigate incidents using provided incident details and code context',
      icon: 'Search',
      defaultTrigger: { expr: '0 15 * * MON-FRI', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Investigate recent incidents described in linked issues, project docs, logs, or prompt notes using the codebase as context. Summarize likely causes, affected systems, contributing code paths, missing safeguards, and concrete follow-up fixes. If no incident details are available, report what information is needed instead of guessing.',
      },
    },
  ],
  'Status reports': [
    {
      id: 'daily-change-summary',
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
      id: 'weekly-eng-report',
      name: 'Write a weekly report',
      description: "Summarize the week's merged work, risks, and open questions every Friday",
      icon: 'CalendarDays',
      defaultTrigger: { expr: '0 16 * * 5', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Write a concise weekly engineering summary: shipped work, in-progress efforts, risky or notable changes, recurring problems, and suggested priorities for next week. Reference relevant commits or pull requests and highlight anything that needs a decision.',
      },
    },
    {
      id: 'release-notes-draft',
      name: 'Draft release notes',
      description: 'Turn changes merged since the last release into user-facing release notes',
      icon: 'Rocket',
      defaultTrigger: { expr: '0 15 * * 5', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Draft user-facing release notes for changes merged since the last release tag. Group entries into features, improvements, and fixes, translate internal terminology into language users understand, and call out breaking changes or upgrade steps explicitly. Skip internal-only changes.',
      },
    },
  ],
  Documentation: [
    {
      id: 'docs-generator',
      name: 'Generate docs',
      description:
        'Create and update developer documentation for recently changed or under-documented code',
      icon: 'BookOpen',
      defaultTrigger: { expr: '0 14 * * 5', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Find recently changed or under-documented developer-facing code. Add concise documentation that explains behavior, setup, examples, sharp edges, and validation steps. Prefer updating existing docs over creating duplicate pages.',
      },
    },
    {
      id: 'readme-refresh',
      name: 'Keep the README fresh',
      description: 'Verify setup instructions and examples still work and fix documentation drift',
      icon: 'FileText',
      defaultTrigger: { expr: '0 14 * * 3', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Verify that the README and getting-started docs still match the codebase: commands, prerequisites, environment variables, project layout, and examples. Fix drift directly, simplify sections that have grown confusing, and flag claims you cannot verify from the repository.',
      },
    },
    {
      id: 'changelog-update',
      name: 'Maintain the changelog',
      description: 'Add notable merged changes to the changelog in the existing format',
      icon: 'ScrollText',
      defaultTrigger: { expr: '0 9 * * 5', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Update the changelog with notable changes merged since the most recent entry. Follow the existing changelog format and grouping, write entries for readers who have not seen the code, and leave out internal-only noise like formatting or test-only changes.',
      },
    },
  ],
  Maintenance: [
    {
      id: 'feature-flag-cleanup',
      name: 'Clean up feature flags',
      description: 'Find stale feature flags that are fully rolled out and remove dead code paths',
      icon: 'Flag',
      defaultTrigger: { expr: '0 12 * * 3', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Find stale feature flags that appear fully rolled out or permanently disabled. For safe cases, remove dead branches and simplify affected code. Preserve behavior, update tests, and call out flags that need product confirmation instead of changing them.',
      },
    },
    {
      id: 'dead-code-cleanup',
      name: 'Remove dead code',
      description:
        'Find unused exports, unreachable branches, and orphaned files, then delete them safely',
      icon: 'Eraser',
      defaultTrigger: { expr: '0 11 * * 2', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Find code that is safe to delete: unused exports, unreachable branches, orphaned files, stale helpers, and long-commented-out blocks. Verify nothing references the code, including dynamic lookups and config-driven paths, before removing it. Keep deletions small and reviewable, and run relevant validation.',
      },
    },
    {
      id: 'dependency-updates',
      name: 'Update dependencies',
      description:
        'Apply safe patch and minor dependency upgrades and flag majors that need migration work',
      icon: 'PackageOpen',
      defaultTrigger: { expr: '0 9 * * 1', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          "Review dependencies for available updates using the project's package manager. Apply low-risk patch and minor upgrades, skim changelogs for behavior changes, run installs and relevant tests, and list major upgrades that need dedicated migration work instead of attempting them.",
      },
    },
    {
      id: 'todo-burndown',
      name: 'Burn down TODOs',
      description: 'Resolve small TODO and FIXME comments and report the ones that need planning',
      icon: 'ListTodo',
      defaultTrigger: { expr: '0 14 * * 4', tz: 'UTC' },
      defaultConversationConfig: {
        initialPrompt:
          'Find TODO, FIXME, and HACK comments. Implement the ones that are small and safe, delete comments that no longer apply, and summarize the remaining ones as a short prioritized report with file references and suggested next steps.',
      },
    },
  ],
} satisfies Record<AutomationCatalogCategory, CatalogTemplateInput[]>;

export const builtinAutomationCatalog: CatalogTemplate[] = automationCatalogCategories.flatMap(
  (category) =>
    builtinAutomationTemplateInputsByCategory[category].map((template) => ({
      ...template,
      category,
    }))
);

export const builtinAutomationTemplatesByCategory = Object.fromEntries(
  automationCatalogCategories.map((category) => [
    category,
    builtinAutomationCatalog.filter((template) => template.category === category),
  ])
) as Record<AutomationCatalogCategory, CatalogTemplate[]>;

const popularAutomationTemplateIds = [
  'critical-bug-finder',
  'daily-change-summary',
  'codebase-vulnerability-scan',
  'test-coverage',
  'reported-bugs',
  'docs-generator',
];

const builtinAutomationTemplateById = new Map(
  builtinAutomationCatalog.map((template) => [template.id, template])
);

function getBuiltinAutomationTemplate(id: string) {
  const template = builtinAutomationTemplateById.get(id);
  if (!template) {
    throw new Error(`Unknown builtin automation template id: ${id}`);
  }
  return template;
}

export const popularAutomationTemplates = popularAutomationTemplateIds.map(
  getBuiltinAutomationTemplate
);
