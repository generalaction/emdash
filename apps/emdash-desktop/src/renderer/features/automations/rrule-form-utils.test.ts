import { describe, expect, it } from 'vitest';
import { buildRRuleTriggerExpr } from './rrule-form-utils';

describe('buildRRuleTriggerExpr', () => {
  it('preserves the stored DTSTART when saving an edited RRULE line', () => {
    expect(
      buildRRuleTriggerExpr(
        'FREQ=WEEKLY;BYDAY=MO',
        'DTSTART;TZID=Europe/Berlin:20260706T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO'
      )
    ).toBe('DTSTART;TZID=Europe/Berlin:20260706T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO');
  });

  it('keeps full RRULE input with its own DTSTART unchanged', () => {
    expect(
      buildRRuleTriggerExpr(
        'DTSTART;TZID=UTC:20260706T120000\nRRULE:FREQ=WEEKLY;BYDAY=MO',
        'DTSTART;TZID=Europe/Berlin:20260706T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO'
      )
    ).toBe('DTSTART;TZID=UTC:20260706T120000\nRRULE:FREQ=WEEKLY;BYDAY=MO');
  });
});
