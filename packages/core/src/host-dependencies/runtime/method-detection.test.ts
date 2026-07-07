import { describe, expect, it } from 'vitest';
import type { IExecutionContext } from '../../exec/execution-context';
import { createInstallMethodDetector } from './method-detection';
import type { Provenance } from './types';

function makeCtx(
  handler: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec: handler as IExecutionContext['exec'],
    execStreaming: async () => {},
    dispose: () => {},
  } as unknown as IExecutionContext;
}

/**
 * Returns a ctx where brew Cellar/prefix and npm queries produce stable roots.
 * Passes through additional brew subcommands as errors (not-found).
 */
function makeRootCtx(
  brewCellar: string | null,
  npmRoot: string | null,
  opts: { brewPrefix?: string | null } = {}
): IExecutionContext {
  const brewPrefix = opts.brewPrefix !== undefined ? opts.brewPrefix : null;
  return makeCtx(async (command, args = []) => {
    if (command === 'brew' && args[0] === '--cellar') {
      if (brewCellar === null) throw new Error('brew not found');
      return { stdout: `${brewCellar}\n`, stderr: '' };
    }
    if (command === 'brew' && args[0] === '--prefix') {
      if (brewPrefix === null) throw new Error('brew prefix not found');
      return { stdout: `${brewPrefix}\n`, stderr: '' };
    }
    if (command === 'npm' && args[0] === 'root') {
      if (npmRoot === null) throw new Error('npm not found');
      return { stdout: `${npmRoot}\n`, stderr: '' };
    }
    throw new Error(`unexpected: ${command} ${args.join(' ')}`);
  });
}

describe('createInstallMethodDetector', () => {
  describe('homebrew detection', () => {
    it('returns homebrew (confirmed) when realpath is under brew --cellar', async () => {
      const ctx = makeRootCtx('/opt/homebrew/Cellar', null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      const result = await detector.detect('/opt/homebrew/Cellar/claude-code/1.2.3/bin/claude');
      expect(result.kind).toBe('homebrew');
      expect(result.confidence).toBe('confirmed');
      expect(result.managerRef).toBe('claude-code');
    });

    it('returns homebrew for Cellar path containing node_modules (avoids npm misattribution)', async () => {
      const ctx = makeRootCtx('/opt/homebrew/Cellar', '/opt/homebrew/lib/node_modules');
      const detector = createInstallMethodDetector(ctx, 'macos');
      // A Homebrew formula that is a node CLI — realpath is under Cellar AND node_modules.
      // The detector must return 'homebrew', not 'npm'.
      const result = await detector.detect(
        '/opt/homebrew/Cellar/claude-code/1.2.3/libexec/lib/node_modules/@anthropic-ai/claude-code/bin/claude'
      );
      expect(result.kind).toBe('homebrew');
      expect(result.confidence).toBe('confirmed');
    });

    it('returns homebrew for Intel Mac Cellar at /usr/local/Cellar', async () => {
      const ctx = makeRootCtx('/usr/local/Cellar', null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      const result = await detector.detect('/usr/local/Cellar/goose/2.3.1/bin/goose');
      expect(result.kind).toBe('homebrew');
      expect(result.confidence).toBe('confirmed');
    });

    it('returns homebrew for linuxbrew Cellar', async () => {
      const ctx = makeRootCtx('/home/linuxbrew/.linuxbrew/Cellar', null);
      const detector = createInstallMethodDetector(ctx, 'linux');
      const result = await detector.detect(
        '/home/linuxbrew/.linuxbrew/Cellar/claude/1.0.0/bin/claude'
      );
      expect(result.kind).toBe('homebrew');
      expect(result.confidence).toBe('confirmed');
    });

    it('is case-insensitive for homebrew', async () => {
      const ctx = makeRootCtx('/opt/homebrew/Cellar', null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      const result = await detector.detect('/opt/Homebrew/Cellar/claude/1.0.0/bin/claude');
      expect(result.kind).toBe('homebrew');
    });

    it('returns homebrew confirmed for Caskroom path', async () => {
      const ctx = makeRootCtx('/opt/homebrew/Cellar', null, { brewPrefix: '/opt/homebrew' });
      const detector = createInstallMethodDetector(ctx, 'macos');
      const result = await detector.detect('/opt/homebrew/Caskroom/claude/1.0.0/bin/claude');
      expect(result.kind).toBe('homebrew');
      expect(result.confidence).toBe('confirmed');
      expect(result.managerRef).toBe('claude');
    });
  });

  describe('npm detection', () => {
    it('returns npm (confirmed) when realpath is under npm root -g', async () => {
      const ctx = makeRootCtx(null, '/Users/user/.nvm/versions/node/v22.0.0/lib/node_modules');
      const detector = createInstallMethodDetector(ctx, 'macos');
      const result = await detector.detect(
        '/Users/user/.nvm/versions/node/v22.0.0/lib/node_modules/@anthropic-ai/claude-code/bin/claude'
      );
      expect(result.kind).toBe('npm');
      expect(result.confidence).toBe('confirmed');
    });

    it('returns npm for npm global on brew-managed node (path under brew prefix but not Cellar)', async () => {
      const ctx = makeRootCtx('/opt/homebrew/Cellar', '/opt/homebrew/lib/node_modules');
      const detector = createInstallMethodDetector(ctx, 'macos');
      // This path is under /opt/homebrew/lib/node_modules (npm root), NOT under Cellar
      const result = await detector.detect(
        '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude'
      );
      expect(result.kind).toBe('npm');
      expect(result.confidence).toBe('confirmed');
    });

    it('is case-insensitive for npm', async () => {
      const ctx = makeRootCtx(null, '/usr/local/lib/node_modules');
      const detector = createInstallMethodDetector(ctx, 'linux');
      const result = await detector.detect('/usr/local/lib/Node_Modules/@openai/codex/bin/codex');
      expect(result.kind).toBe('npm');
    });
  });

  describe('fallback to inferMethod', () => {
    it('returns cargo (inferred) when neither brew nor npm matches', async () => {
      const ctx = makeRootCtx(null, null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      const result = await detector.detect('/Users/user/.cargo/bin/aichat');
      expect(result.kind).toBe('cargo');
      expect(result.confidence).toBe('inferred');
    });

    it('returns unknown (inferred) for an unrecognised path when both tools are absent', async () => {
      const ctx = makeRootCtx(null, null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      const result = await detector.detect('/usr/local/bin/something');
      expect(result.kind).toBe('unknown');
      expect(result.confidence).toBe('inferred');
    });

    it('falls back to inferMethod when brew query fails', async () => {
      const ctx = makeRootCtx(null, null);
      const detector = createInstallMethodDetector(ctx, 'linux');
      const result = await detector.detect('/home/user/.cargo/bin/aichat');
      expect(result.kind).toBe('cargo');
      expect(result.confidence).toBe('inferred');
    });

    it('falls back to inferMethod hints on Windows (brew not queried)', async () => {
      const ctx = makeCtx(async (command) => {
        if (command === 'npm') {
          throw new Error('npm not found');
        }
        throw new Error(`unexpected: ${command}`);
      });
      const detector = createInstallMethodDetector(ctx, 'windows');
      const result = await detector.detect(
        'C:\\Users\\user\\AppData\\Local\\Microsoft\\WindowsApps\\claude.exe'
      );
      expect(result.kind).toBe('winget');
      expect(result.confidence).toBe('inferred');
    });
  });

  describe('memoisation and invalidation', () => {
    it('queries brew --cellar only once across multiple detect calls', async () => {
      let brewCellarCallCount = 0;
      const ctx = makeCtx(async (command, args = []) => {
        if (command === 'brew' && args[0] === '--cellar') {
          brewCellarCallCount++;
          return { stdout: '/opt/homebrew/Cellar\n', stderr: '' };
        }
        if (command === 'brew' && args[0] === '--prefix') throw new Error('no prefix');
        if (command === 'npm') throw new Error('no npm');
        throw new Error('unexpected');
      });
      const detector = createInstallMethodDetector(ctx, 'macos');

      await detector.detect('/opt/homebrew/Cellar/tool/1.0.0/bin/tool');
      await detector.detect('/opt/homebrew/Cellar/other/2.0.0/bin/other');

      expect(brewCellarCallCount).toBe(1);
    });

    it('queries npm root -g only once across multiple detect calls', async () => {
      let npmCallCount = 0;
      const ctx = makeCtx(async (command, args = []) => {
        if (command === 'brew') throw new Error('no brew');
        if (command === 'npm' && args[0] === 'root') {
          npmCallCount++;
          return { stdout: '/usr/local/lib/node_modules\n', stderr: '' };
        }
        throw new Error('unexpected');
      });
      const detector = createInstallMethodDetector(ctx, 'macos');

      await detector.detect('/usr/local/lib/node_modules/@openai/codex/bin/codex');
      await detector.detect('/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude');

      expect(npmCallCount).toBe(1);
    });

    it('re-queries brew after invalidate()', async () => {
      let brewCallCount = 0;
      const ctx = makeCtx(async (command, args = []) => {
        if (command === 'brew' && args[0] === '--cellar') {
          brewCallCount++;
          return { stdout: '/opt/homebrew/Cellar\n', stderr: '' };
        }
        if (command === 'brew' && args[0] === '--prefix') throw new Error('no prefix');
        if (command === 'npm') throw new Error('no npm');
        throw new Error('unexpected');
      });
      const detector = createInstallMethodDetector(ctx, 'macos');

      await detector.detect('/opt/homebrew/Cellar/tool/1.0.0/bin/tool');
      expect(brewCallCount).toBe(1);

      detector.invalidate();
      await detector.detect('/opt/homebrew/Cellar/other/2.0.0/bin/other');
      expect(brewCallCount).toBe(2);
    });

    it('re-queries npm root after invalidate()', async () => {
      let npmCallCount = 0;
      const ctx = makeCtx(async (command, args = []) => {
        if (command === 'brew') throw new Error('no brew');
        if (command === 'npm' && args[0] === 'root') {
          npmCallCount++;
          return { stdout: '/usr/local/lib/node_modules\n', stderr: '' };
        }
        throw new Error('unexpected');
      });
      const detector = createInstallMethodDetector(ctx, 'macos');

      await detector.detect('/usr/local/lib/node_modules/@openai/codex/bin/codex');
      expect(npmCallCount).toBe(1);

      detector.invalidate();
      await detector.detect('/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude');
      expect(npmCallCount).toBe(2);
    });

    it('provides Provenance type with kind, confidence, and optional managerRef', async () => {
      const ctx = makeRootCtx('/opt/homebrew/Cellar', null);
      const detector = createInstallMethodDetector(ctx, 'macos');
      const result: Provenance = await detector.detect(
        '/opt/homebrew/Cellar/claude-code/1.2.3/bin/claude'
      );
      expect(result).toMatchObject({
        kind: 'homebrew',
        confidence: 'confirmed',
        managerRef: 'claude-code',
      });
    });
  });
});
