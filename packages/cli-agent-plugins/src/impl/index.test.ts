import { describe, expect, it } from 'vitest';
import { iconRegistry } from '../icons';
import { metadataRegistry } from '../metadata';
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

// ── metadataRegistry ──────────────────────────────────────────────────────────

describe('metadataRegistry', () => {
  it('has exactly 31 entries', () => {
    expect(metadataRegistry.getAll()).toHaveLength(31);
  });

  it('contains all expected provider ids', () => {
    const ids = metadataRegistry.ids();
    for (const expected of EXPECTED_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it('each entry has required string fields', () => {
    for (const m of metadataRegistry.getAll()) {
      expect(typeof m.id).toBe('string');
      expect(m.id.length).toBeGreaterThan(0);
      expect(typeof m.name).toBe('string');
      expect(typeof m.description).toBe('string');
      expect(typeof m.websiteUrl).toBe('string');
    }
  });

  it('metadata entries contain no function values', () => {
    for (const m of metadataRegistry.getAll()) {
      const values = Object.values(m as unknown as Record<string, unknown>);
      // Top-level fields must not be functions
      for (const v of values) {
        expect(typeof v).not.toBe('function');
      }
      // Capabilities fields must not be functions
      for (const v of Object.values(m.capabilities as unknown as Record<string, unknown>)) {
        expect(typeof v).not.toBe('function');
      }
    }
  });

  it('each entry has required capabilities', () => {
    for (const m of metadataRegistry.getAll()) {
      const { capabilities } = m;
      expect(capabilities.install).toBeDefined();
      expect(capabilities.hooks).toBeDefined();
      expect(capabilities.mcp).toBeDefined();
      expect(capabilities.plugin).toBeDefined();
      expect(['supported', 'none']).toContain(capabilities.autoApprove.kind);
      expect(['resumable', 'stateless']).toContain(capabilities.sessions.kind);
    }
  });

  it('all binaryNames are non-empty strings', () => {
    for (const m of metadataRegistry.getAll()) {
      expect(m.capabilities.install.binaryNames.length).toBeGreaterThan(0);
      for (const bin of m.capabilities.install.binaryNames) {
        expect(typeof bin).toBe('string');
        expect(bin.length).toBeGreaterThan(0);
      }
    }
  });

  it('models and effort are all kind:none', () => {
    for (const m of metadataRegistry.getAll()) {
      expect(m.capabilities.models.kind).toBe('none');
      expect(m.capabilities.effort.kind).toBe('none');
    }
  });

  it('each expected id is retrievable', () => {
    for (const id of EXPECTED_IDS) {
      const m = metadataRegistry.get(id);
      expect(m).toBeDefined();
      expect(m?.id).toBe(id);
    }
  });
});

// ── iconRegistry ──────────────────────────────────────────────────────────────

describe('iconRegistry', () => {
  it('has exactly 31 entries', () => {
    expect(iconRegistry.ids()).toHaveLength(31);
  });

  it('each icon is a React component (function)', () => {
    for (const id of EXPECTED_IDS) {
      const icon = iconRegistry.get(id);
      expect(icon).toBeDefined();
      expect(typeof icon).toBe('function');
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

  it('each provider has a buildCommand function', () => {
    for (const p of providerRegistry.getAll()) {
      expect(typeof p.buildCommand).toBe('function');
    }
  });

  it('each provider references its metadata', () => {
    for (const p of providerRegistry.getAll()) {
      const meta = metadataRegistry.get(p.metadata.id);
      expect(meta).toBe(p.metadata);
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
  const makeCtx = (overrides = {}) => ({
    cli: '/usr/local/bin/agent',
    autoApprove: false,
    model: '',
    ...overrides,
  });

  it('codex deduplicates --dangerously-bypass-approvals-and-sandbox', () => {
    const p = providerRegistry.get('codex')!;
    const cmd = p.buildCommand(
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
    const cmd = p.buildCommand(
      makeCtx({ autoApprove: true, isResuming: true, sessionId: 'ses-1' })
    );
    expect(cmd.args).not.toContain('--yolo');
  });

  it('kimi includes auto-approve on fresh session', () => {
    const p = providerRegistry.get('kimi')!;
    const cmd = p.buildCommand(makeCtx({ autoApprove: true, isResuming: false }));
    expect(cmd.args).toContain('--yolo');
  });

  it('amp wraps with stdin pipe when prompt given', () => {
    const p = providerRegistry.get('amp')!;
    const cmd = p.buildCommand(makeCtx({ initialPrompt: 'hello amp' }));
    expect(cmd.command).toBe('bash');
    expect(cmd.args[1]).toContain('hello amp');
  });

  it('amp includes PLUGINS=all env', () => {
    const p = providerRegistry.get('amp')!;
    const cmd = p.buildCommand(makeCtx({}));
    expect(cmd.env).toHaveProperty('PLUGINS', 'all');
  });

  it('opencode uses env var for auto-approve', () => {
    const p = providerRegistry.get('opencode')!;
    const cmd = p.buildCommand(makeCtx({ autoApprove: true }));
    expect(cmd.env).toHaveProperty('OPENCODE_AUTO_APPROVE', 'true');
    expect(cmd.args).not.toContain('--auto-approve');
  });

  it('opencode validateSessionId accepts ses-prefixed ids', () => {
    const p = providerRegistry.get('opencode')!;
    expect(p.validateSessionId?.('ses-abc123')).toBe(true);
    expect(p.validateSessionId?.('ses')).toBe(true);
    expect(p.validateSessionId?.('other-id')).toBe(false);
  });

  it('letta appends --new for fresh session', () => {
    const p = providerRegistry.get('letta')!;
    const cmd = p.buildCommand(makeCtx({ isResuming: false }));
    expect(cmd.args).toContain('--new');
  });

  it('letta does not append --new on resume', () => {
    const p = providerRegistry.get('letta')!;
    const cmd = p.buildCommand(makeCtx({ isResuming: true }));
    expect(cmd.args).not.toContain('--new');
  });

  it('letta skipVersionProbe is true in metadata', () => {
    const m = metadataRegistry.get('letta')!;
    expect(m.capabilities.install.skipVersionProbe).toBe(true);
  });
});
