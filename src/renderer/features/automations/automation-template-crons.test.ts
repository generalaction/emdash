import { describe, expect, it } from 'vitest';
import { parseCron, toCron } from '@renderer/lib/CronPicker/cron-utils';
import { builtinAutomationCatalog } from '@shared/automations/builtin-catalog';

describe('automation template crons', () => {
  it('keeps every builtin template cron editable in the CronPicker', () => {
    for (const template of builtinAutomationCatalog) {
      expect(parseCron(template.defaultTrigger.expr), template.id).not.toBeNull();
    }
  });

  it('round-trips every builtin template cron through the CronPicker unchanged', () => {
    for (const template of builtinAutomationCatalog) {
      const state = parseCron(template.defaultTrigger.expr);
      if (!state) continue;
      expect(toCron(state), template.id).toBe(template.defaultTrigger.expr);
    }
  });
});
