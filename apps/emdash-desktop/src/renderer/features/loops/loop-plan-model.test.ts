import { describe, expect, it } from 'vitest';
import {
  createDefaultLoopPlanDraft,
  normalizeLoopPlan,
  orderedLoopPlanPhases,
  validateLoopPlanDraft,
} from './loop-plan-model';

describe('loop plan model', () => {
  it('normalizes Markdown headings deterministically', () => {
    const input = {
      goal: 'Ship account security',
      planSource: [
        '## Add passkeys',
        'Implement registration and sign-in.',
        '',
        '### Add recovery',
        'Keep the fallback flow accessible.',
      ].join('\n'),
    };

    const first = normalizeLoopPlan(input);
    const second = normalizeLoopPlan(input);

    expect(first).toEqual(second);
    expect(first.workPhases).toEqual([
      {
        id: 'work-1',
        kind: 'work',
        name: 'Add passkeys',
        goal: 'Implement registration and sign-in.',
      },
      {
        id: 'work-2',
        kind: 'work',
        name: 'Add recovery',
        goal: 'Keep the fallback flow accessible.',
      },
    ]);
  });

  it('normalizes numbered and checkbox items in source order', () => {
    const draft = normalizeLoopPlan({
      goal: 'Deliver the feature',
      planSource: [
        '1. Build the service',
        '2) Add the renderer',
        '- [ ] Cover keyboard navigation',
        '* [x] Document the behavior',
      ].join('\n'),
    });

    expect(draft.workPhases.map(({ name, goal }) => ({ name, goal }))).toEqual([
      { name: 'Build the service', goal: 'Build the service' },
      { name: 'Add the renderer', goal: 'Add the renderer' },
      { name: 'Cover keyboard navigation', goal: 'Cover keyboard navigation' },
      { name: 'Document the behavior', goal: 'Document the behavior' },
    ]);
  });

  it('ignores structure markers inside fenced code and preserves multiline phase bodies', () => {
    const draft = normalizeLoopPlan({
      goal: 'Ship safely',
      planSource: [
        '## Build API',
        'First line.\r',
        'Second line.\r',
        '```md\r',
        '1. This is an example, not a phase.\r',
        '```\r',
        '## Build API',
      ].join('\n'),
    });

    expect(draft.workPhases).toEqual([
      {
        id: 'work-1',
        kind: 'work',
        name: 'Build API',
        goal: [
          'First line.',
          'Second line.',
          '```md',
          '1. This is an example, not a phase.',
          '```',
        ].join('\n'),
      },
      {
        id: 'work-2',
        kind: 'work',
        name: 'Build API',
        goal: 'Build API',
      },
    ]);
  });

  it('preserves heading text ending in a literal hash', () => {
    const draft = normalizeLoopPlan({
      goal: 'Document the language examples',
      planSource: '## Learn C#\nKeep the literal language name.',
    });

    expect(draft.workPhases[0]?.name).toBe('Learn C#');
  });

  it('requires a matching fence length and a bare closing fence', () => {
    const draft = normalizeLoopPlan({
      goal: 'Keep examples out of the phase list',
      planSource: [
        '## Real phase',
        '````md',
        '## Inside four ticks',
        '```',
        '## Still inside four ticks',
        '````',
        '```md',
        '```oops',
        '## Still inside the info fence',
        '```',
        '## Final phase',
      ].join('\n'),
    });

    expect(draft.workPhases.map((phase) => phase.name)).toEqual(['Real phase', 'Final phase']);
  });

  it('uses source order when headings, numbered items, and nested checkboxes are mixed', () => {
    const draft = normalizeLoopPlan({
      goal: 'Ship the release',
      planSource: [
        '# Release foundation',
        'Establish the shared contract.',
        '1. Build the service',
        'Implement the runtime.',
        '   - [ ] Cover keyboard navigation',
        'Verify tab order and focus.',
        '## Finish the rollout',
      ].join('\n'),
    });

    expect(draft.workPhases.map(({ name, goal }) => ({ name, goal }))).toEqual([
      { name: 'Release foundation', goal: 'Establish the shared contract.' },
      { name: 'Build the service', goal: 'Implement the runtime.' },
      { name: 'Cover keyboard navigation', goal: 'Verify tab order and focus.' },
      { name: 'Finish the rollout', goal: 'Finish the rollout' },
    ]);
  });

  it('falls back to one editable phase from the goal when the plan has no structure', () => {
    const draft = normalizeLoopPlan({
      goal: 'Make task creation resilient',
      planSource: 'This prose intentionally has no Markdown phase structure.',
    });

    expect(draft.workPhases).toEqual([
      {
        id: 'work-1',
        kind: 'work',
        name: 'Phase 1',
        goal: 'Make task creation resilient',
      },
    ]);
    expect(draft.planSource).toBe('This prose intentionally has no Markdown phase structure.');
  });

  it('uses inert authoring defaults and keeps terminal gates independently selectable', () => {
    expect(createDefaultLoopPlanDraft()).toEqual({
      enabled: false,
      goal: '',
      planSource: '',
      workPhases: [
        {
          id: 'work-1',
          kind: 'work',
          name: 'Phase 1',
          goal: '',
        },
      ],
      terminalGates: { review: false, e2e: false },
    });

    const base = normalizeLoopPlan({
      goal: 'Ship it',
      planSource: '1. Implement\n2. Test',
    });
    expect(orderedLoopPlanPhases(base).map((phase) => phase.kind)).toEqual(['work', 'work']);
    expect(
      orderedLoopPlanPhases({
        ...base,
        terminalGates: { review: true, e2e: false },
      }).map((phase) => phase.kind)
    ).toEqual(['work', 'work', 'review']);
    expect(
      orderedLoopPlanPhases({
        ...base,
        terminalGates: { review: false, e2e: true },
      }).map((phase) => phase.kind)
    ).toEqual(['work', 'work', 'e2e']);
    expect(
      orderedLoopPlanPhases({
        ...base,
        terminalGates: { review: true, e2e: true },
      }).map((phase) => phase.kind)
    ).toEqual(['work', 'work', 'review', 'e2e']);
  });

  it('reports validation errors without discarding the editable draft', () => {
    const draft = { ...createDefaultLoopPlanDraft(), enabled: true };

    expect(validateLoopPlanDraft(draft)).toEqual([
      'Add a goal for this Loop.',
      'Describe what Phase 1 should complete.',
    ]);
    expect(draft.workPhases).toHaveLength(1);
    expect(draft.workPhases[0]?.name).toBe('Phase 1');
  });

  it('validates the goal and every editable work-phase field', () => {
    const draft = {
      ...createDefaultLoopPlanDraft(),
      enabled: true,
      goal: 'Ship the feature',
      workPhases: [
        { id: 'work-1', kind: 'work' as const, name: '', goal: '' },
        { id: 'work-2', kind: 'work' as const, name: 'Renderer', goal: '' },
      ],
    };

    expect(validateLoopPlanDraft(draft)).toEqual([
      'Name Phase 1.',
      'Describe what Phase 1 should complete.',
      'Describe what Renderer should complete.',
    ]);
    expect(draft.workPhases).toHaveLength(2);
  });
});
