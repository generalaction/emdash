import { describe, expect, it } from 'vitest';
import { taskSettingsSchema } from './schema';
import { getDefaultForKey } from './settings-registry';

describe('task auto-cleanup settings', () => {
  it('defaults to off', () => {
    expect(getDefaultForKey('tasks').autoCleanupOnPrMerge).toBe('off');
  });

  it.each(['off', 'archive', 'delete'] as const)('accepts %s', (autoCleanupOnPrMerge) => {
    const parsed = taskSettingsSchema.parse({
      ...getDefaultForKey('tasks'),
      autoCleanupOnPrMerge,
    });

    expect(parsed.autoCleanupOnPrMerge).toBe(autoCleanupOnPrMerge);
  });

  it('rejects unknown cleanup actions', () => {
    expect(() =>
      taskSettingsSchema.parse({
        ...getDefaultForKey('tasks'),
        autoCleanupOnPrMerge: 'destroy',
      })
    ).toThrow();
  });
});
