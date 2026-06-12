import type { CommandContext } from '@emdash/shared/agents/plugins';
import { describe, expect, it } from 'vitest';
import { definitionRegistry } from '../definitions';
import { providerRegistry } from '../providers';

const EXPECTED_IDS = [
  'codex',
  'claude',
  'grok',
  'devin',
  'qwen',
  'droid',
  'gemini',
  'antigravity',
  'cursor',
  'copilot',
  'amp',
  'commandcode',
  'opencode',
  'hermes',
  'charm',
  'auggie',
  'goose',
  'kimi',
  'kilocode',
  'kiro',
  'rovo',
  'cline',
  'continue',
  'codebuff',
  'freebuff',
  'mistral',
  'jules',
  'junie',
  'pi',
  'letta',
  'autohand',
] as const;

// ── definitionRegistry ────────────────────────────────────────────────────────

describe('definitionRegistry', () => {
  it('has exactly 31 entries', () => {
    expect(definitionRegistry.getAll()).toHaveLength(31);
  });

  it('contains all expected provider ids', () => {
    const ids = definitionRegistry.ids();
    for (const expected of EXPECTED_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it('each entry has required string fields', () => {
    for (const d of definitionRegistry.getAll()) {
      expect(typeof d.metadata.id).toBe('string');
      expect(d.metadata.id.length).toBeGreaterThan(0);
      expect(typeof d.metadata.name).toBe('string');
      expect(typeof d.metadata.description).toBe('string');
      expect(typeof d.metadata.websiteUrl).toBe('string');
    }
  });

  it('each entry passes validate() with no errors', () => {
    for (const d of definitionRegistry.getAll()) {
      const errors = d.validate();
      expect(errors, `${d.metadata.id} validate() errors: ${JSON.stringify(errors)}`).toHaveLength(
        0
      );
    }
  });

  it('capabilities contain no function values at top level', () => {
    for (const d of definitionRegistry.getAll()) {
      for (const v of Object.values(d.capabilities as Record<string, unknown>)) {
        expect(typeof v).not.toBe('function');
      }
    }
  });

  it('each entry has required capabilities', () => {
    for (const d of definitionRegistry.getAll()) {
      const { capabilities } = d;
      expect(capabilities.hostDependency).toBeDefined();
      expect(capabilities.hooks).toBeDefined();
      expect(capabilities.mcp).toBeDefined();
      expect(capabilities.plugins).toBeDefined();
      expect(['supported', 'none']).toContain(capabilities.autoApprove.kind);
      expect(['resumable', 'stateless']).toContain(capabilities.sessions.kind);
    }
  });

  it('each entry has hostDependency.updates with valid kind', () => {
    for (const d of definitionRegistry.getAll()) {
      expect(d.capabilities.hostDependency.updates).toBeDefined();
      expect(['supported', 'none']).toContain(d.capabilities.hostDependency.updates.kind);
    }
  });

  it('supported updates have valid releaseSource and update strategy', () => {
    for (const d of definitionRegistry.getAll()) {
      if (d.capabilities.hostDependency.updates.kind !== 'supported') continue;
      const { releaseSource, update } = d.capabilities.hostDependency.updates;
      expect(['npm', 'github', 'none']).toContain(releaseSource.kind);
      expect(['package-manager', 'cli', 'auto', 'none']).toContain(update.kind);
    }
  });

  it('all binaryNames are non-empty strings', () => {
    for (const d of definitionRegistry.getAll()) {
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
    for (const d of definitionRegistry.getAll()) {
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
    for (const d of definitionRegistry.getAll()) {
      expect(d.assets.icon).toBeDefined();
      expect(d.assets.icon.variants.length).toBeGreaterThan(0);
      for (const v of d.assets.icon.variants) {
        expect(typeof v.light).toBe('string');
        expect(v.light.length).toBeGreaterThan(0);
      }
    }
  });

  it('each expected id is retrievable', () => {
    for (const id of EXPECTED_IDS) {
      const d = definitionRegistry.get(id);
      expect(d).toBeDefined();
      expect(d?.metadata.id).toBe(id);
    }
  });
});

// ── providerRegistry ──────────────────────────────────────────────────────────

describe('providerRegistry', () => {
  it('has exactly 31 entries', () => {
    expect(providerRegistry.getAll()).toHaveLength(31);
  });

  it('contains all expected provider ids', () => {
    const ids = providerRegistry.ids();
    for (const expected of EXPECTED_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it('each provider has a behavior.prompt.buildCommand function', () => {
    for (const p of providerRegistry.getAll()) {
      expect(typeof p.behavior.prompt?.buildCommand).toBe('function');
    }
  });

  it('each provider metadata matches its definition', () => {
    for (const p of providerRegistry.getAll()) {
      const def = definitionRegistry.get(p.metadata.id);
      expect(def).toBeDefined();
      expect(def?.metadata.id).toBe(p.metadata.id);
    }
  });

  it('each expected id is retrievable', () => {
    for (const id of EXPECTED_IDS) {
      const p = providerRegistry.get(id);
      expect(p).toBeDefined();
      expect(p?.metadata.id).toBe(id);
    }
  });
});

// ── Special cases via providerRegistry ───────────────────────────────────────

describe('special case buildCommand', () => {
  const makeCtx = (overrides: Partial<CommandContext> = {}): CommandContext => ({
    cli: '/usr/local/bin/agent',
    autoApprove: false,
    model: '',
    ...overrides,
  });

  it('codex deduplicates --dangerously-bypass-approvals-and-sandbox', () => {
    const p = providerRegistry.get('codex')!;
    const cmd = p.behavior.prompt!.buildCommand(
      makeCtx({
        autoApprove: true,
        extraArgs: ['--dangerously-bypass-approvals-and-sandbox'],
      })
    );
    const count = cmd.args.filter((a) => a === '--dangerously-bypass-approvals-and-sandbox').length;
    expect(count).toBeLessThanOrEqual(1);
  });

  it('kimi omits auto-approve flag on resume', () => {
    const p = providerRegistry.get('kimi')!;
    const cmd = p.behavior.prompt!.buildCommand(
      makeCtx({ autoApprove: true, isResuming: true, providerSessionId: 'ses-1' })
    );
    expect(cmd.args).not.toContain('--yolo');
  });

  it('kimi includes auto-approve on fresh session', () => {
    const p = providerRegistry.get('kimi')!;
    const cmd = p.behavior.prompt!.buildCommand(makeCtx({ autoApprove: true, isResuming: false }));
    expect(cmd.args).toContain('--yolo');
  });

  it('amp wraps with stdin pipe when prompt given', () => {
    const p = providerRegistry.get('amp')!;
    const cmd = p.behavior.prompt!.buildCommand(makeCtx({ initialPrompt: 'hello amp' }));
    expect(cmd.command).toBe('bash');
    expect(cmd.args[1]).toContain('hello amp');
  });

  it('amp includes PLUGINS=all env', () => {
    const p = providerRegistry.get('amp')!;
    const cmd = p.behavior.prompt!.buildCommand(makeCtx({}));
    expect(cmd.env).toHaveProperty('PLUGINS', 'all');
  });

  it('opencode uses OPENCODE_PERMISSION env var for auto-approve', () => {
    const p = providerRegistry.get('opencode')!;
    const cmd = p.behavior.prompt!.buildCommand(makeCtx({ autoApprove: true }));
    expect(cmd.env).toHaveProperty('OPENCODE_PERMISSION');
    expect(cmd.args).not.toContain('--auto-approve');
  });

  it('opencode validateSessionId accepts ses-prefixed ids', () => {
    const p = providerRegistry.get('opencode')!;
    expect(p.behavior.sessions?.validateSessionId?.('ses-abc123')).toBe(true);
    expect(p.behavior.sessions?.validateSessionId?.('ses')).toBe(true);
    expect(p.behavior.sessions?.validateSessionId?.('other-id')).toBe(false);
  });

  it('letta appends --new for fresh session', () => {
    const p = providerRegistry.get('letta')!;
    const cmd = p.behavior.prompt!.buildCommand(makeCtx({ isResuming: false }));
    expect(cmd.args).toContain('--new');
  });

  it('letta does not append --new on resume', () => {
    const p = providerRegistry.get('letta')!;
    const cmd = p.behavior.prompt!.buildCommand(makeCtx({ isResuming: true }));
    expect(cmd.args).not.toContain('--new');
  });

  it('letta skipVersionProbe is true in hostDependency', () => {
    const d = definitionRegistry.get('letta')!;
    expect(d.capabilities.hostDependency.skipVersionProbe).toBe(true);
  });
});
