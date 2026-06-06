import { describe, expect, it } from 'vitest';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { buildPiExecCommand, isPiThinkingLevel } from './pi-exec-command';

const PI_CONFIG: ProviderCustomConfig = {
  cli: 'pi',
  defaultArgs: ['--provider', 'openai'],
  extraArgs: '--no-themes',
};

describe('buildPiExecCommand', () => {
  it('builds a JSON print turn with a deterministic session id', () => {
    const { command, args } = buildPiExecCommand({
      providerConfig: PI_CONFIG,
      sessionId: '0dc5c1e2-f008-4594-a9b6-694037bedc88',
      prompt: 'do the thing',
    });
    expect(command).toBe('pi');
    expect(args).toEqual([
      '--provider',
      'openai',
      '--no-themes',
      '--mode',
      'json',
      '--print',
      '--session-id',
      '0dc5c1e2-f008-4594-a9b6-694037bedc88',
      'do the thing',
    ]);
  });

  it('passes supported thinking levels and drops unsupported native-chat efforts', () => {
    const high = buildPiExecCommand({
      providerConfig: PI_CONFIG,
      sessionId: 'session',
      reasoningEffort: 'high',
      prompt: 'go',
    });
    expect(high.args).toContain('--thinking');
    expect(high.args[high.args.indexOf('--thinking') + 1]).toBe('high');

    const max = buildPiExecCommand({
      providerConfig: PI_CONFIG,
      sessionId: 'session',
      reasoningEffort: 'max',
      prompt: 'go',
    });
    expect(max.args).not.toContain('--thinking');
  });

  it('honors a custom cli prefix and rejects unsafe model ids', () => {
    const { command, args } = buildPiExecCommand({
      providerConfig: { ...PI_CONFIG, cli: 'npx @mariozechner/pi-coding-agent' },
      sessionId: 'session',
      model: 'gpt-5.4-mini',
      prompt: 'hi',
    });
    expect(command).toBe('npx');
    expect(args[0]).toBe('@mariozechner/pi-coding-agent');
    expect(args).toContain('gpt-5.4-mini');

    const providerQualified = buildPiExecCommand({
      providerConfig: PI_CONFIG,
      sessionId: 'session',
      model: 'openai/gpt-4o',
      prompt: 'hi',
    });
    expect(providerQualified.args).toContain('openai/gpt-4o');

    const thinkingAlias = buildPiExecCommand({
      providerConfig: PI_CONFIG,
      sessionId: 'session',
      model: 'sonnet:high',
      prompt: 'hi',
    });
    expect(thinkingAlias.args).toContain('sonnet:high');

    expect(() =>
      buildPiExecCommand({
        providerConfig: PI_CONFIG,
        sessionId: 'session',
        model: 'bad model; rm -rf /',
        prompt: 'x',
      })
    ).toThrow(/Invalid model id/);
  });
});

describe('isPiThinkingLevel', () => {
  it('accepts Pi thinking levels used by the native menu', () => {
    expect(isPiThinkingLevel('low')).toBe(true);
    expect(isPiThinkingLevel('xhigh')).toBe(true);
    expect(isPiThinkingLevel('max')).toBe(false);
  });
});
