import { describe, expect, it } from 'vitest';
import {
  defaultAgentConfig,
  AGENT_CONFIG_FILE,
  isAgentConfigPath,
  parseAgentConfig,
} from './agent-config';

describe('isAgentConfigPath', () => {
  it('matches root config paths across path styles', () => {
    expect(isAgentConfigPath(`/repo/${AGENT_CONFIG_FILE}`)).toBe(true);
    expect(isAgentConfigPath(AGENT_CONFIG_FILE)).toBe(true);
    expect(isAgentConfigPath('C:\\repo\\.agent.json')).toBe(true);
  });

  it('does not match unrelated files', () => {
    expect(isAgentConfigPath('/repo/src/index.ts')).toBe(false);
    expect(isAgentConfigPath('/repo/.agent.json.bak')).toBe(false);
  });
});

describe('parseAgentConfig', () => {
  it('filters the config file from preserve patterns', () => {
    expect(
      parseAgentConfig(JSON.stringify({ preservePatterns: ['.env', AGENT_CONFIG_FILE] }))
    ).toEqual({
      success: true,
      data: { preservePatterns: ['.env'] },
    });
  });

  it('silently ignores stale keys from retired features (excludePatterns)', () => {
    expect(
      parseAgentConfig(JSON.stringify({ excludePatterns: ['**'], preservePatterns: ['.env'] }))
    ).toEqual({
      success: true,
      data: { preservePatterns: ['.env'] },
    });
  });

  it('has no built-in preserve defaults', () => {
    expect(defaultAgentConfig()).toEqual({});
    expect(parseAgentConfig('{}')).toEqual({ success: true, data: {} });
  });

  it('returns defaults and the parse error for invalid content', () => {
    const result = parseAgentConfig('{');
    expect(result.success).toBe(false);
    expect(result.data).toEqual(defaultAgentConfig());
    if (!result.success) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });
});
