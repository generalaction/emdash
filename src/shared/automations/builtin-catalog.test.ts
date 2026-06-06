import { describe, expect, it } from 'vitest';
import { builtinAutomationCatalog, popularAutomationTemplates } from './builtin-catalog';

describe('builtinAutomationCatalog', () => {
  it('has unique template ids', () => {
    const ids = builtinAutomationCatalog.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique popular template ids', () => {
    const ids = popularAutomationTemplates.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has complete content for every template', () => {
    for (const template of builtinAutomationCatalog) {
      expect(template.name.trim(), template.id).not.toBe('');
      expect(template.description.trim(), template.id).not.toBe('');
      expect(template.icon.trim(), template.id).not.toBe('');
      expect(template.defaultConversationConfig.initialPrompt.trim(), template.id).not.toBe('');
    }
  });
});
