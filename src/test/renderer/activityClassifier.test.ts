import { describe, expect, it } from 'vitest';
import { classifyActivity } from '../../renderer/lib/activityClassifier';

describe('classifyActivity', () => {
  describe('opencode', () => {
    it('treats braille spinner frames as busy activity', () => {
      expect(classifyActivity('opencode', '⠋')).toBe('busy');
    });

    it('treats spinner text with the default Working prompt as busy activity', () => {
      expect(classifyActivity('opencode', '⠙ Working...')).toBe('busy');
    });

    it('keeps ready prompts classified as idle', () => {
      expect(classifyActivity('opencode', 'Type your message')).toBe('idle');
    });
  });
});
