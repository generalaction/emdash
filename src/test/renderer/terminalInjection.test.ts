import { describe, expect, it } from 'vitest';
import {
  buildCommentInjectionPayload,
  buildPromptInjectionPayload,
} from '../../renderer/lib/terminalInjection';

describe('terminalInjection helpers', () => {
  describe('buildCommentInjectionPayload', () => {
    it('uses raw multiline payload for claude', () => {
      const result = buildCommentInjectionPayload({
        providerId: 'claude',
        inputData: 'fix this\r',
        pendingText: '\n<user_comments>\n  <file path="a.ts" />\n</user_comments>',
      });

      expect(result.payload).toBe(
        'fix this\n<user_comments>\n  <file path="a.ts" />\n</user_comments>'
      );
      expect(result.submitDelayMs).toBeGreaterThan(0);
    });

    it('uses bracketed paste for non-claude comments', () => {
      const result = buildCommentInjectionPayload({
        providerId: 'gemini',
        inputData: 'fix this\r',
        pendingText: '\n<user_comments>\n  <file path="a.ts" />\n</user_comments>',
      });

      expect(result.payload.startsWith('\x1b[200~fix this\n<user_comments>')).toBe(true);
      expect(result.payload.endsWith('\x1b[201~')).toBe(true);
      expect(result.submitDelayMs).toBeGreaterThan(0);
    });
  });

  describe('buildPromptInjectionPayload', () => {
    it('keeps claude multiline payload unwrapped', () => {
      const result = buildPromptInjectionPayload({
        agent: 'claude',
        text: 'hello\nworld',
      });

      expect(result.payload).toBe('hello\nworld');
    });

    it('uses bracketed paste for non-claude multiline payload', () => {
      const result = buildPromptInjectionPayload({
        agent: 'codex',
        text: 'hello\nworld',
      });

      expect(result.payload).toBe('\x1b[200~hello\nworld\x1b[201~');
      expect(result.submitDelayMs).toBeGreaterThan(0);
    });

    it('uses simple payload for non-claude single-line input', () => {
      const result = buildPromptInjectionPayload({
        agent: 'gemini',
        text: 'hello world',
      });

      expect(result.payload).toBe('hello world');
    });
  });
});
