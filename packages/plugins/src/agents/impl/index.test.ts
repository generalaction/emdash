import { describe, expect, it } from 'vitest';
import { pluginRegistry } from '../registry';

describe('pluginRegistry', () => {
  it('each entry has required string fields', () => {
    for (const d of pluginRegistry.getAll()) {
      expect(typeof d.metadata.id).toBe('string');
      expect(d.metadata.id.length).toBeGreaterThan(0);
      expect(typeof d.metadata.name).toBe('string');
      expect(typeof d.metadata.description).toBe('string');
      expect(typeof d.metadata.websiteUrl).toBe('string');
    }
  });

  it('each entry passes validate() with no errors', () => {
    for (const d of pluginRegistry.getAll()) {
      const errors = d.validate();
      expect(errors, `${d.metadata.id} validate() errors: ${JSON.stringify(errors)}`).toHaveLength(
        0
      );
    }
  });

  it('capabilities contain no function values at top level', () => {
    for (const d of pluginRegistry.getAll()) {
      for (const v of Object.values(d.capabilities as Record<string, unknown>)) {
        expect(typeof v).not.toBe('function');
      }
    }
  });

  it('each entry has required capabilities', () => {
    for (const d of pluginRegistry.getAll()) {
      const { capabilities } = d;
      expect(capabilities.hostDependency).toBeDefined();
      expect(capabilities.auth).toBeDefined();
      expect(capabilities.hooks).toBeDefined();
      expect(capabilities.mcp).toBeDefined();
      expect(capabilities.plugins).toBeDefined();
      expect(['supported', 'none']).toContain(capabilities.acp.kind);
      expect(['supported', 'none']).toContain(capabilities.autoApprove.kind);
      expect(['resumable', 'stateless']).toContain(capabilities.sessions.kind);
    }
  });

  it('each entry has hostDependency.updates with valid kind', () => {
    for (const d of pluginRegistry.getAll()) {
      expect(d.capabilities.hostDependency.updates).toBeDefined();
      expect(['supported', 'none']).toContain(d.capabilities.hostDependency.updates.kind);
    }
  });

  it('supported updates have valid releaseSource and update strategy', () => {
    for (const d of pluginRegistry.getAll()) {
      if (d.capabilities.hostDependency.updates.kind !== 'supported') continue;
      const { releaseSource, update } = d.capabilities.hostDependency.updates;
      expect(['npm', 'github', 'none']).toContain(releaseSource.kind);
      expect(['package-manager', 'cli', 'auto', 'none']).toContain(update.kind);
    }
  });

  it('all binaryNames are non-empty strings', () => {
    for (const d of pluginRegistry.getAll()) {
      expect(d.capabilities.hostDependency.binaryNames.length).toBeGreaterThan(0);
      for (const bin of d.capabilities.hostDependency.binaryNames) {
        expect(typeof bin).toBe('string');
        expect(bin.length).toBeGreaterThan(0);
      }
    }
  });

  it('each defined platform installCommands entry is a non-empty array of valid InstallOptions', () => {
    const validMethods = [
      'installer-macos',
      'installer-windows',
      'installer-linux',
      'homebrew',
      'winget',
      'powershell',
      'npm',
      'apt',
      'curl',
      'pip',
      'cargo',
      'other',
    ];
    for (const d of pluginRegistry.getAll()) {
      const { installCommands } = d.capabilities.hostDependency;
      for (const [platform, options] of Object.entries(installCommands)) {
        expect(Array.isArray(options), `${d.metadata.id}.${platform} should be an array`).toBe(
          true
        );
        expect(
          options!.length,
          `${d.metadata.id}.${platform} array should be non-empty`
        ).toBeGreaterThan(0);
        for (const opt of options!) {
          expect(
            typeof opt.command,
            `${d.metadata.id}.${platform} command should be a string`
          ).toBe('string');
          expect(
            opt.command.length,
            `${d.metadata.id}.${platform} command should be non-empty`
          ).toBeGreaterThan(0);
          expect(validMethods, `${d.metadata.id}.${platform} method should be valid`).toContain(
            opt.method
          );
        }
      }
    }
  });

  it('each entry has an icon asset with at least one variant', () => {
    for (const d of pluginRegistry.getAll()) {
      expect(d.assets.icon).toBeDefined();
      expect(d.assets.icon.variants.length).toBeGreaterThan(0);
      for (const v of d.assets.icon.variants) {
        expect(typeof v.light).toBe('string');
        expect(v.light.length).toBeGreaterThan(0);
      }
    }
  });

  it('each entry has a behavior.prompt.buildCommand function', () => {
    for (const p of pluginRegistry.getAll()) {
      expect(typeof p.behavior.prompt?.buildCommand).toBe('function');
    }
  });

  it('passes Grok initial prompts as positional argv for interactive sessions', () => {
    const result = pluginRegistry.get('grok')!.behavior.prompt!.buildCommand({
      cli: 'grok',
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: false,
      model: '',
    });

    expect(result).toEqual({
      command: 'grok',
      args: ['--always-approve', 'Fix the bug'],
      env: {},
    });
  });

  it('uses current Grok docs, npm release source, Windows install, and model flag', () => {
    const grok = pluginRegistry.get('grok')!;

    expect(grok.metadata.websiteUrl).toBe('https://docs.x.ai/build/overview');
    expect(grok.capabilities.hostDependency.installDocs).toBe('https://docs.x.ai/build/overview');
    expect(
      grok.capabilities.hostDependency.installCommands.macos?.map((opt) => opt.method)
    ).toEqual(['curl', 'npm']);
    expect(grok.capabilities.hostDependency.installCommands.macos?.[1]?.command).toBe(
      'npm install -g @xai-official/grok@latest'
    );
    expect(
      grok.capabilities.hostDependency.installCommands.windows?.map((opt) => opt.method)
    ).toEqual(['powershell', 'npm']);
    expect(grok.capabilities.hostDependency.updates).toMatchObject({
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@xai-official/grok' },
      update: { kind: 'package-manager' },
    });

    const result = grok.behavior.prompt!.buildCommand({
      cli: 'grok',
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: false,
      model: 'my-model',
    });

    expect(result.args).toEqual(['--always-approve', '-m', 'my-model', 'Fix the bug']);
  });

  it('exposes Antigravity models and passes the selected model flag', () => {
    const antigravity = pluginRegistry.get('antigravity')!;

    expect(antigravity.capabilities.models).toMatchObject({
      kind: 'selectable',
      modelOptions: {
        'Gemini 3.5 Flash (Medium)': {
          name: 'Gemini 3.5 Flash (Medium)',
        },
        'Claude Opus 4.6 (Thinking)': {
          name: 'Claude Opus 4.6 (Thinking)',
        },
      },
    });

    const result = antigravity.behavior.prompt!.buildCommand({
      cli: 'agy',
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: false,
      model: 'Claude Opus 4.6 (Thinking)',
    });

    expect(result.args).toEqual([
      '--conversation=conv-1',
      '--dangerously-skip-permissions',
      '--model',
      'Claude Opus 4.6 (Thinking)',
      '-i',
      'Fix the bug',
    ]);
  });

  it('uses the current Amp npm package for install and updates', () => {
    const amp = pluginRegistry.get('amp')!;

    expect(amp.capabilities.hostDependency.installCommands.macos?.[0]?.command).toBe(
      'npm install -g @ampcode/cli@latest'
    );
    expect(amp.capabilities.hostDependency.updates).toMatchObject({
      kind: 'supported',
      releaseSource: { kind: 'npm', package: '@ampcode/cli' },
    });
  });

  it('exposes Amp modes as selectable models and passes them with -m', () => {
    const amp = pluginRegistry.get('amp')!;

    expect(amp.capabilities.models).toMatchObject({
      kind: 'selectable',
      modelOptions: {
        smart: { name: 'Smart' },
        rush: { name: 'Rush' },
        deep: { name: 'Deep' },
      },
    });

    const result = amp.behavior.prompt!.buildCommand({
      cli: 'amp',
      autoApprove: true,
      initialPrompt: '',
      sessionId: 'conv-1',
      isResuming: false,
      model: 'deep',
    });

    expect(result.args).toEqual(['--dangerously-allow-all', '-m', 'deep']);
  });

  it('exposes Mistral Vibe models and passes the selected model through env', () => {
    const mistral = pluginRegistry.get('mistral')!;

    expect(mistral.capabilities.models).toMatchObject({
      kind: 'selectable',
      modelOptions: {
        'mistral-medium-3.5': { name: 'Mistral Medium 3.5' },
        'devstral-small': { name: 'Devstral Small' },
        local: { name: 'Local Devstral' },
      },
    });

    const result = mistral.behavior.prompt!.buildCommand({
      cli: 'vibe',
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: false,
      model: 'mistral-medium-3.5',
    });

    expect(result).toEqual({
      command: 'vibe',
      args: ['--agent', 'auto-approve', 'Fix the bug'],
      env: { VIBE_ACTIVE_MODEL: 'mistral-medium-3.5' },
    });
  });

  it('resumes Pi with the stored session file instead of the latest session', () => {
    const pi = pluginRegistry.get('pi')!;

    expect(pi.capabilities.hooks.kind).toBe('plugin');
    if (pi.capabilities.hooks.kind !== 'plugin') throw new Error('Pi hooks should be plugin hooks');
    expect(pi.capabilities.hooks.supportedEvents).toContain('session');

    const fresh = pi.behavior.prompt!.buildCommand({
      cli: 'pi',
      autoApprove: false,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: false,
      model: '',
    });
    expect(fresh.args).toEqual(['Fix the bug']);

    const resumed = pi.behavior.prompt!.buildCommand({
      cli: 'pi',
      autoApprove: false,
      sessionId: 'conv-1',
      providerSessionId: '/Users/test/.pi/agent/sessions/project/session.jsonl',
      isResuming: true,
      model: '',
    });
    expect(resumed.args).toEqual([
      '--session',
      '/Users/test/.pi/agent/sessions/project/session.jsonl',
    ]);
  });

  it('registers Qoder CLI install metadata and interactive command args', () => {
    const qoder = pluginRegistry.get('qoder')!;

    expect(qoder.metadata.websiteUrl).toBe('https://qoder.com/en/cli');
    expect(qoder.capabilities.hostDependency.binaryNames).toEqual(['qodercli']);
    expect(qoder.capabilities.hostDependency.installDocs).toBe('https://qoder.com/en/cli');
    expect(
      qoder.capabilities.hostDependency.installCommands.macos?.map((opt) => opt.method)
    ).toEqual(['npm', 'curl']);
    expect(qoder.capabilities.hostDependency.installCommands.macos?.[0]?.command).toBe(
      'npm install -g @qoder-ai/qodercli'
    );
    expect(
      qoder.capabilities.hostDependency.installCommands.windows?.map((opt) => opt.method)
    ).toEqual(['npm', 'powershell']);

    const fresh = qoder.behavior.prompt!.buildCommand({
      cli: 'qodercli',
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: false,
      model: '',
    });

    expect(fresh).toEqual({
      command: 'qodercli',
      args: ['--yolo', 'Fix the bug'],
      env: {},
    });

    const resumed = qoder.behavior.prompt!.buildCommand({
      cli: 'qodercli',
      autoApprove: true,
      initialPrompt: '',
      sessionId: 'conv-1',
      providerSessionId: 'qoder-session-1',
      isResuming: true,
      model: '',
    });

    expect(resumed.args).toEqual(['-r', 'qoder-session-1', '--yolo']);
  });
});
