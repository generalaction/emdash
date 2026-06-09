import { describe, expect, it } from 'vitest';
import type { CLIAgentPluginFs } from '../core/plugin';
import {
  buildClaudeHookConfig,
  buildCopilotHookConfig,
  buildCodexHookConfig,
  buildGrokHookConfig,
  buildKimiHookConfig,
  buildKiroHookConfig,
  addKimiHooksToConfigText,
} from './hook-config';
import { EMDASH_MARKER } from './hooks';

function mockFs(files: Record<string, string> = {}): CLIAgentPluginFs & {
  _files: Record<string, string>;
} {
  const store: Record<string, string> = { ...files };
  return {
    _files: store,
    read: async (p) => store[p] ?? null,
    write: async (p, c) => {
      store[p] = c;
    },
    delete: async (p) => {
      delete store[p];
    },
    exists: async (p) => p in store,
    list: async () => [],
  };
}

// ── Claude hooks (nested shape) ─────────────────────────────────────────────

describe('claude hook config', () => {
  const cfg = buildClaudeHookConfig();
  const PATH = '.claude/settings.local.json';

  it('reports not installed when file missing', async () => {
    const fs = mockFs();
    expect(await cfg.getHooksInstalled(fs)).toBe(false);
    expect(await cfg.readHooks(fs)).toEqual([]);
  });

  it('writes hooks in nested format', async () => {
    const fs = mockFs();
    await cfg.writeHooks(fs, []);
    const raw = JSON.parse(fs._files[PATH]!);
    expect(raw.hooks).toBeDefined();
    expect(raw.hooks.Notification).toBeDefined();
    const notifEntry = raw.hooks.Notification[0];
    expect(notifEntry).toHaveProperty('hooks');
    expect(notifEntry.hooks[0]).toHaveProperty('type', 'command');
    expect(notifEntry.hooks[0].command).toContain(EMDASH_MARKER);
  });

  it('preserves user entries and adds emdash entries', async () => {
    const initial = JSON.stringify({
      hooks: { Notification: [{ hooks: [{ type: 'command', command: 'user-cmd' }] }] },
    });
    const fs = mockFs({ [PATH]: initial });
    await cfg.writeHooks(fs, []);
    const raw = JSON.parse(fs._files[PATH]!);
    const entries = raw.hooks.Notification as unknown[];
    expect(entries.length).toBe(2); // user + emdash
    expect(JSON.stringify(entries[0])).toContain('user-cmd');
  });

  it('reports installed after write', async () => {
    const fs = mockFs();
    await cfg.writeHooks(fs, []);
    expect(await cfg.getHooksInstalled(fs)).toBe(true);
  });

  it('deleteHooks removes emdash entries', async () => {
    const fs = mockFs();
    await cfg.writeHooks(fs, []);
    await cfg.deleteHooks(fs);
    const raw = JSON.parse(fs._files[PATH]!);
    const allEntries = Object.values(raw.hooks as Record<string, unknown[]>).flat();
    expect(allEntries.every((e) => !JSON.stringify(e).includes(EMDASH_MARKER))).toBe(true);
  });
});

// ── Copilot hooks (flat shape) ──────────────────────────────────────────────

describe('copilot hook config', () => {
  const cfg = buildCopilotHookConfig();
  const PATH = '.github/hooks/emdash.json';

  it('writes flat copilot hook format', async () => {
    const fs = mockFs();
    await cfg.writeHooks(fs, []);
    const raw = JSON.parse(fs._files[PATH]!);
    expect(raw.version).toBe(1);
    expect(raw.hooks.agentStop).toBeDefined();
    const stopEntry = raw.hooks.agentStop[0];
    expect(stopEntry).toHaveProperty('type', 'command');
    expect(stopEntry.command).toContain(EMDASH_MARKER);
  });
});

// ── Kiro hooks ───────────────────────────────────────────────────────────────

describe('kiro hook config', () => {
  const cfg = buildKiroHookConfig();
  const PATH = '.kiro/agents/emdash.json';

  it('writes kiro simple command format', async () => {
    const fs = mockFs();
    await cfg.writeHooks(fs, []);
    const raw = JSON.parse(fs._files[PATH]!);
    expect(raw.name).toBe('emdash');
    expect(raw.hooks.stop).toBeDefined();
    const stopEntry = raw.hooks.stop[0];
    expect(stopEntry).toHaveProperty('command');
    expect(stopEntry.command).toContain(EMDASH_MARKER);
    // Should NOT have nested { hooks: [...] } format
    expect(stopEntry).not.toHaveProperty('hooks');
  });
});

// ── Codex hooks ──────────────────────────────────────────────────────────────

describe('codex hook config', () => {
  const cfg = buildCodexHookConfig();
  const PATH = '.codex/hooks.json';

  it('writes codex notification-type hooks', async () => {
    const fs = mockFs();
    await cfg.writeHooks(fs, []);
    const raw = JSON.parse(fs._files[PATH]!);
    expect(raw.hooks.Stop).toBeDefined();
    const stopEntry = raw.hooks.Stop[0];
    expect(stopEntry.hooks[0].command).toContain('idle_prompt');
    expect(raw.hooks.PermissionRequest[0].hooks[0].command).toContain('permission_prompt');
    expect(raw.hooks.SessionStart).toBeDefined();
  });
});

// ── Kimi hooks (TOML) ────────────────────────────────────────────────────────

describe('kimi hook config', () => {
  const cfg = buildKimiHookConfig();
  const PATH = '.kimi-code/config.toml';

  it('reports not installed when file missing', async () => {
    const fs = mockFs();
    expect(await cfg.getHooksInstalled(fs)).toBe(false);
  });

  it('writes TOML format with hook entries', async () => {
    const fs = mockFs();
    await cfg.writeHooks(fs, []);
    const content = fs._files[PATH];
    expect(content).toBeDefined();
    expect(content).toContain(EMDASH_MARKER);
    // TOML format: should have [[hooks]] tables
    expect(content).toContain('hooks');
  });

  it('preserves user entries', async () => {
    // Write a config with a user-defined hook first
    const initial = `[[hooks]]\nevent = "Stop"\ncommand = "user-hook-cmd"\n`;
    const fs = mockFs({ [PATH]: initial });
    await cfg.writeHooks(fs, []);
    const content = fs._files[PATH];
    expect(content).toContain('user-hook-cmd');
    expect(content).toContain(EMDASH_MARKER);
  });
});

// ── Grok hooks ───────────────────────────────────────────────────────────────

describe('grok hook config', () => {
  const cfg = buildGrokHookConfig();
  const PATH = '.grok/hooks/emdash.json';

  it('writes all grok hook events', async () => {
    const fs = mockFs();
    await cfg.writeHooks(fs, []);
    const raw = JSON.parse(fs._files[PATH]!);
    expect(raw.hooks.SessionStart).toBeDefined();
    expect(raw.hooks.Stop).toBeDefined();
    expect(raw.hooks.Notification).toBeDefined();
    expect(raw.hooks.UserPromptSubmit).toBeDefined();
    // Grok session-start uses GROK_SESSION_ID
    const sessionCmd = raw.hooks.SessionStart[0].hooks[0].command;
    expect(sessionCmd).toContain('GROK_SESSION_ID');
  });
});

// ── addKimiHooksToConfigText ─────────────────────────────────────────────────

describe('addKimiHooksToConfigText', () => {
  it('injects hooks into JSON config text', () => {
    const input = JSON.stringify({ key: 'value' });
    const result = addKimiHooksToConfigText(input);
    const parsed = JSON.parse(result) as { hooks: unknown[] };
    expect(Array.isArray(parsed.hooks)).toBe(true);
    expect(parsed.hooks.some((h) => JSON.stringify(h).includes(EMDASH_MARKER))).toBe(true);
  });

  it('preserves user hooks and injects emdash hooks', () => {
    const input = JSON.stringify({ hooks: [{ event: 'Stop', command: 'user-cmd' }] });
    const result = addKimiHooksToConfigText(input);
    const parsed = JSON.parse(result) as { hooks: Array<{ command: string }> };
    expect(parsed.hooks.some((h) => h.command === 'user-cmd')).toBe(true);
    expect(parsed.hooks.some((h) => h.command.includes(EMDASH_MARKER))).toBe(true);
  });

  it('returns content unchanged if unparseable', () => {
    const bad = 'not valid json or toml %%$#';
    const result = addKimiHooksToConfigText(bad);
    expect(result).toBe(bad);
  });
});
