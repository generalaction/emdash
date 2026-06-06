import { describe, expect, it } from 'vitest';
import { parseCron, toCron } from '@renderer/lib/CronPicker/cron-utils';
import { builtinAutomationCatalog } from '@shared/automations/builtin-catalog';

describe('automation template crons', () => {
  it('keeps every supported builtin template cron editable in the CronPicker', () => {
    for (const template of builtinAutomationCatalog) {
      if (template.defaultTrigger.expr.endsWith('MON-FRI')) continue;
      expect(parseCron(template.defaultTrigger.expr), template.id).not.toBeNull();
    }
  });

  it('round-trips every supported builtin template cron through the CronPicker unchanged', () => {
    for (const template of builtinAutomationCatalog) {
      if (template.defaultTrigger.expr.endsWith('MON-FRI')) continue;
      const state = parseCron(template.defaultTrigger.expr);
      if (!state) continue;
      expect(toCron(state), template.id).toBe(template.defaultTrigger.expr);
    }
  });
});
