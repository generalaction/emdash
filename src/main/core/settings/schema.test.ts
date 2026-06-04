import { describe, expect, it } from 'vitest';
import { providerConfigDefaults } from './schema';

describe('providerConfigDefaults ACP metadata', () => {
  it('keeps terminal as the default while exposing documented ACP commands', () => {
    expect(providerConfigDefaults.codex).toMatchObject({
      defaultConversationRuntime: 'terminal',
      acpCommand: ['npx', '-y', '@zed-industries/codex-acp@0.15.0'],
    });
    expect(providerConfigDefaults.claude).toMatchObject({
      defaultConversationRuntime: 'terminal',
      acpCommand: ['npx', '-y', '@agentclientprotocol/claude-agent-acp@0.40.0'],
    });
    expect(providerConfigDefaults.cursor).toMatchObject({
      defaultConversationRuntime: 'terminal',
      acpCommand: ['cursor-agent', 'acp'],
    });
    expect(providerConfigDefaults.gemini).toMatchObject({
      defaultConversationRuntime: 'terminal',
      acpCommand: ['gemini', '--acp'],
    });
    expect(providerConfigDefaults.opencode).toMatchObject({
      defaultConversationRuntime: 'terminal',
      acpCommand: ['opencode', 'acp'],
    });
    expect(providerConfigDefaults.copilot).toMatchObject({
      defaultConversationRuntime: 'terminal',
      acpCommand: ['copilot', '--acp'],
    });
    expect(providerConfigDefaults.qwen).toMatchObject({
      defaultConversationRuntime: 'terminal',
      acpCommand: ['qwen', '--acp', '--experimental-skills'],
    });
    expect(providerConfigDefaults.droid).toMatchObject({
      defaultConversationRuntime: 'terminal',
      acpCommand: ['npx', '-y', 'droid@0.140.0', 'exec', '--output-format', 'acp-daemon'],
    });
    expect(providerConfigDefaults.goose).toMatchObject({
      defaultConversationRuntime: 'terminal',
      acpCommand: ['goose', 'acp'],
    });
    expect(providerConfigDefaults.kimi).toMatchObject({
      defaultConversationRuntime: 'terminal',
      acpCommand: ['kimi', 'acp'],
    });
  });
});
