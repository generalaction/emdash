import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
    getName: vi.fn().mockReturnValue('emdash-test'),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
  },
}));

vi.mock('../../main/lib/logger', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('https', () => ({
  request: vi.fn(),
}));

import {
  getApiKeyForProvider,
  getDefaultModelForProvider,
} from '../../main/services/SummaryGenerationService';

describe('SummaryGenerationService', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('getDefaultModelForProvider', () => {
    it('returns haiku for claude', () => {
      expect(getDefaultModelForProvider('claude')).toBe('claude-haiku-4-5-20251001');
    });

    it('returns gpt-4o-mini for codex', () => {
      expect(getDefaultModelForProvider('codex')).toBe('gpt-4o-mini');
    });

    it('returns gemini flash for gemini', () => {
      expect(getDefaultModelForProvider('gemini')).toBe('gemini-2.0-flash-lite');
    });

    it('returns haiku as fallback', () => {
      expect(getDefaultModelForProvider('unknown-provider')).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('getApiKeyForProvider', () => {
    it('returns ANTHROPIC_API_KEY for claude', () => {
      const original = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key';
      expect(getApiKeyForProvider('claude')).toBe('test-key');
      if (original) process.env.ANTHROPIC_API_KEY = original;
      else delete process.env.ANTHROPIC_API_KEY;
    });

    it('returns OPENAI_API_KEY for codex', () => {
      const original = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-openai-key';
      expect(getApiKeyForProvider('codex')).toBe('test-openai-key');
      if (original) process.env.OPENAI_API_KEY = original;
      else delete process.env.OPENAI_API_KEY;
    });
  });
});
