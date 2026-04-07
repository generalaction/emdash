import { describe, expect, it } from 'vitest';
import {
  buildCommentInjectionPayload,
  buildPromptInjectionPayload,
  getPromptSubmitDelayMs,
  getPromptSubmitKey,
  getSlowStartupConfig,
  hasDelayedSubmitStartup,
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

    it('uses raw payload for amp comments', () => {
      const result = buildCommentInjectionPayload({
        providerId: 'amp',
        inputData: 'fix this\r',
        pendingText: '\n<user_comments>\n  <file path="a.ts" />\n</user_comments>',
      });

      expect(result.payload).toBe(
        'fix this\n<user_comments>\n  <file path="a.ts" />\n</user_comments>'
      );
      expect(result.submitDelayMs).toBeGreaterThan(0);
    });

    it('uses bracketed paste payload for opencode comments', () => {
      const result = buildCommentInjectionPayload({
        providerId: 'opencode',
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

    it('keeps amp multiline payload unwrapped', () => {
      const result = buildPromptInjectionPayload({
        agent: 'amp',
        text: 'hello\nworld',
      });

      expect(result.payload).toBe('hello\nworld');
    });

    it('uses bracketed paste for opencode multiline payload', () => {
      const result = buildPromptInjectionPayload({
        agent: 'opencode',
        text: 'hello\nworld',
      });

      expect(result.payload).toBe('\x1b[200~hello\nworld\x1b[201~');
    });
  });

  describe('getPromptSubmitKey', () => {
    it('uses carriage return for all providers', () => {
      expect(getPromptSubmitKey('amp')).toBe('\r');
      expect(getPromptSubmitKey('codex')).toBe('\r');
      expect(getPromptSubmitKey('claude')).toBe('\r');
      expect(getPromptSubmitKey('opencode')).toBe('\r');
    });
  });

  describe('getPromptSubmitDelayMs', () => {
    it('uses longer submit delay for amp and opencode', () => {
      expect(getPromptSubmitDelayMs('amp')).toBe(220);
      expect(getPromptSubmitDelayMs('opencode')).toBe(220);
    });

    it('uses default submit delay for other providers', () => {
      expect(getPromptSubmitDelayMs('codex')).toBe(50);
      expect(getPromptSubmitDelayMs('claude')).toBe(50);
    });
  });

  describe('hasDelayedSubmitStartup', () => {
    it('returns true for slow-startup providers', () => {
      expect(hasDelayedSubmitStartup('amp')).toBe(true);
      expect(hasDelayedSubmitStartup('opencode')).toBe(true);
    });

    it('returns false for normal providers', () => {
      expect(hasDelayedSubmitStartup('claude')).toBe(false);
      expect(hasDelayedSubmitStartup('codex')).toBe(false);
    });
  });

  describe('getSlowStartupConfig', () => {
    it('returns config for amp', () => {
      const cfg = getSlowStartupConfig('amp');
      expect(cfg).not.toBeNull();
      expect(cfg!.skipIdleRetries).toBe(false);
      expect(cfg!.maxSubmitRetries).toBeGreaterThan(0);
    });

    it('returns config for opencode with idle retries skipped', () => {
      const cfg = getSlowStartupConfig('opencode');
      expect(cfg).not.toBeNull();
      expect(cfg!.skipIdleRetries).toBe(true);
    });

    it('returns null for normal providers', () => {
      expect(getSlowStartupConfig('claude')).toBeNull();
      expect(getSlowStartupConfig('codex')).toBeNull();
    });
  });
});
