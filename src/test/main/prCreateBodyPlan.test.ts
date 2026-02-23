import { describe, expect, it } from 'vitest';
import { getCreatePrBodyPlan } from '../../main/lib/prCreateBodyPlan';

describe('getCreatePrBodyPlan', () => {
  it('patches footer after fill when there is no explicit body', () => {
    const plan = getCreatePrBodyPlan({
      fill: true,
      title: 'feat: add workflow',
      rawBody: undefined,
      enrichedBody:
        '<!-- emdash-issue-footer:start -->\nFixes #42\n<!-- emdash-issue-footer:end -->',
    });

    expect(plan).toEqual({
      shouldPatchFilledBody: true,
      shouldUseBodyFile: false,
      shouldUseFill: true,
    });
  });

  it('uses body file when user provided body exists', () => {
    const plan = getCreatePrBodyPlan({
      fill: true,
      title: 'feat: add workflow',
      rawBody: '## Summary\nUser body',
      enrichedBody:
        '## Summary\nUser body\n\n<!-- emdash-issue-footer:start -->\nFixes #42\n<!-- emdash-issue-footer:end -->',
    });

    expect(plan).toEqual({
      shouldPatchFilledBody: false,
      shouldUseBodyFile: true,
      shouldUseFill: false,
    });
  });

  it('keeps fill for title inference while still using body file', () => {
    const plan = getCreatePrBodyPlan({
      fill: true,
      title: undefined,
      rawBody: '## Summary\nUser body',
      enrichedBody:
        '## Summary\nUser body\n\n<!-- emdash-issue-footer:start -->\nFixes #42\n<!-- emdash-issue-footer:end -->',
    });

    expect(plan).toEqual({
      shouldPatchFilledBody: false,
      shouldUseBodyFile: true,
      shouldUseFill: true,
    });
  });

  it('uses fill when no body is provided and no footer is injected', () => {
    const plan = getCreatePrBodyPlan({
      fill: true,
      title: 'feat: add workflow',
      rawBody: undefined,
      enrichedBody: undefined,
    });

    expect(plan).toEqual({
      shouldPatchFilledBody: false,
      shouldUseBodyFile: false,
      shouldUseFill: true,
    });
  });

  it('does not use fill or body file when fill is disabled and body missing', () => {
    const plan = getCreatePrBodyPlan({
      fill: false,
      title: 'feat: add workflow',
      rawBody: undefined,
      enrichedBody: undefined,
    });

    expect(plan).toEqual({
      shouldPatchFilledBody: false,
      shouldUseBodyFile: false,
      shouldUseFill: false,
    });
  });
});
